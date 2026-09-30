#!/usr/bin/env python3
"""Read-only access checks for the existing VE macOS LaunchAgent.

Run locally. Verified passwords/cards are printed only to the local terminal;
share only the final summary. No reset, API login, database write or restart.
"""
import csv
import hashlib
import hmac
import os
from pathlib import Path
import plistlib
import re
import sqlite3
import subprocess
import sys
import urllib.request


def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=10)
        return result.stdout if result.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def password_matches(password, encoded):
    try:
        salt, key = encoded.split(":")
        if len(key) != 128:
            return False
        actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384,
                                r=8, p=1, dklen=64, maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(actual, bytes.fromhex(key))
    except (ValueError, TypeError):
        return False


def fields(path):
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = re.match(r"^(账户|密码|班级码|匿名编号|恢复码)\s+(.+)$", line.strip())
        if match:
            values[match[1]] = match[2].strip()
    return values


def connect_readonly(path):
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True,
                                 timeout=3)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def service_processes(pid):
    pids = [pid]
    # A launch wrapper may spawn the Node process that holds the database.
    for parent in pids:
        for child in command(["/usr/bin/pgrep", "-P", str(parent)]).splitlines():
            if child.isdigit() and int(child) not in pids and len(pids) < 20:
                pids.append(int(child))
    return pids


def running_databases(pids):
    output = command(["/usr/sbin/lsof", "-a", "-p", ",".join(map(str, pids)), "-Fn"])
    paths = {Path(line[1:]) for line in output.splitlines() if line.startswith("n/")}
    matches = []
    for path in sorted(paths):
        if path.suffix.lower() not in (".db", ".sqlite", ".sqlite3"):
            continue
        try:
            with path.open("rb") as stream:
                if stream.read(16) != b"SQLite format 3\x00":
                    continue
            connection = connect_readonly(path)
            try:
                names = {row[0] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'")}
            finally:
                connection.close()
            if {"Teacher", "Classroom", "Learner"}.issubset(names):
                matches.append(path.resolve())
        except (OSError, sqlite3.Error):
            continue
    return sorted(set(matches))


def health(port):
    # Loopback checks must not pass through a configured HTTP proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open("http://127.0.0.1:%d/api/health" % port, timeout=4) as response:
            return "HTTP %d" % response.status
    except Exception as error:
        return "无法连接（%s）" % type(error).__name__


def student_sources(project, downloads):
    for path in sorted((project / "tmp").glob("*student-access*.txt")):
        try:
            value = fields(path)
            yield path.name, value["班级码"], value["匿名编号"], value["恢复码"]
        except (OSError, UnicodeError, KeyError):
            continue
    # The UI uses exactly this filename; do not scan unrelated downloads.
    for path in sorted(downloads.glob("learning-cards*.csv")):
        if not re.fullmatch(r"learning-cards(?:[ -]?\(\d+\)|[- ]\d+)?\.csv", path.name):
            continue
        try:
            with path.open(encoding="utf-8-sig", newline="") as stream:
                reader = csv.DictReader(stream)
                for value in reader:
                    yield (path.name, value["班级码"], value["匿名学习编号"],
                           value["私密恢复码"])
        except (OSError, UnicodeError, KeyError, csv.Error):
            continue


def verify_access(connection, project, downloads):
    teachers = list(connection.execute(
        'SELECT id, username, displayName, passwordHash FROM "Teacher" ORDER BY username'))
    classrooms = list(connection.execute(
        'SELECT c.*, t.username FROM "Classroom" c JOIN "Teacher" t '
        'ON t.id=c.teacherId ORDER BY c.createdAt'))
    learners = list(connection.execute(
        'SELECT classroomId, number, recoveryHash, active FROM "Learner"'))
    saved_teachers = {}
    stale_teacher = 0
    for path in sorted((project / "tmp").glob("teacher-access-*.txt")):
        try:
            value = fields(path)
            teacher = next((row for row in teachers if row["username"] == value.get("账户")), None)
            if teacher and password_matches(value.get("密码", ""), teacher["passwordHash"]):
                saved_teachers[teacher["username"]] = value["密码"]
            else:
                stale_teacher += 1
        except (OSError, UnicodeError):
            stale_teacher += 1

    print("\n【仅在本机查看：真实教师账号】")
    print("教师入口：http://127.0.0.1:3110/teacher")
    for teacher in teachers:
        print("账户：%s（%s）" % (teacher["username"], teacher["displayName"]))
        password = saved_teachers.get(teacher["username"])
        print("密码：" + password if password else "密码：没有找到与当前数据库匹配的明文凭据，需定向恢复")
    if not teachers:
        print("运行中的数据库没有教师账号。")

    print("\n【课堂与学生入口】")
    print("学生入口：http://127.0.0.1:3110/")
    for classroom in classrooms:
        total = sum(row["classroomId"] == classroom["id"] for row in learners)
        print("%s｜教师 %s｜%s｜班级码 %s｜%s｜%d 张学习卡" % (
            classroom["name"], classroom["username"], classroom["dataSource"],
            classroom["joinCode"], "开放" if classroom["joinOpen"] else "未开放", total))

    valid_classes = set()
    stale_cards = 0
    blocked_cards = 0
    for source, code, number, recovery in student_sources(project, downloads):
        code, number, recovery = code.strip().upper(), number.strip().upper(), recovery.strip()
        classroom = next((row for row in classrooms if row["joinCode"] == code), None)
        learner = next((row for row in learners if classroom and
                        row["classroomId"] == classroom["id"] and row["number"] == number), None)
        if not learner or not hmac.compare_digest(
                hashlib.sha256(recovery.encode()).hexdigest(), learner["recoveryHash"]):
            stale_cards += 1
            continue
        if not classroom["joinOpen"] or not learner["active"]:
            blocked_cards += 1
            continue
        if classroom["id"] in valid_classes:
            continue
        valid_classes.add(classroom["id"])
        print("\n【仅在本机查看：已核验学生学习卡】")
        print("课堂：%s（%s）｜来源：%s" % (classroom["name"], classroom["dataSource"], source))
        print("班级码：%s\n匿名编号：%s\n恢复码：%s" % (code, number, recovery))
    if not valid_classes:
        print("未找到可以登录的学生学习卡；数据库只保存恢复码的校验值，不能还原明文。")
    return [
        "真实教师账号：" + ("、".join(row["username"] for row in teachers) or "无"),
        "教师凭据匹配 %d 个；旧凭据不匹配 %d 个" % (len(saved_teachers), stale_teacher),
        "可用学生学习卡覆盖 %d 个班级；失效卡 %d 张；课堂关闭或卡停用 %d 张" %
        (len(valid_classes), stale_cards, blocked_cards),
    ]


def main():
    summary = []
    try:
        if sys.platform != "darwin":
            raise RuntimeError("请在运行 VE 服务的 Mac 终端执行此脚本。")
        plist = Path.home() / "Library/LaunchAgents/com.sunyancai.ve-app.plist"
        with plist.open("rb") as stream:
            config = plistlib.load(stream)
        project = Path(config["WorkingDirectory"])
        summary.append("项目目录：%s" % project)
        state = command(["/bin/launchctl", "print", "gui/%d/com.sunyancai.ve-app" % os.getuid()])
        match = re.search(r"^\s*pid = (\d+)\s*$", state, re.MULTILINE)
        summary.append("应用进程：" + (match[1] if match else "未运行或无法读取"))
        for port in (3110, 3100):
            summary.append("端口 %d：%s" % (port, health(port)))
        if not match:
            raise RuntimeError("未找到运行中的应用进程，先恢复生产服务。")
        pids = service_processes(int(match[1]))
        listeners = command(["/usr/sbin/lsof", "-a", "-p", ",".join(map(str, pids)),
                             "-iTCP", "-sTCP:LISTEN", "-Fn"])
        summary.append("应用监听：" + ("、".join(line[1:] for line in listeners.splitlines()
                                              if line.startswith("n")) or "未发现"))
        databases = running_databases(pids)
        if len(databases) != 1:
            raise RuntimeError("运行进程发现 %d 个 VE 数据库，无法唯一确认；不读取猜测的数据库。" % len(databases))
        summary.append("运行数据库：%s" % databases[0])
        connection = connect_readonly(databases[0])
        try:
            summary.extend(verify_access(connection, project, Path.home() / "Downloads"))
        finally:
            connection.close()
    except (OSError, KeyError, sqlite3.Error, RuntimeError) as error:
        summary.append("检查未完成：%s" % error)
    print("\n【可发回的检查摘要：不含密码和恢复码】")
    print("\n".join(summary))


if __name__ == "__main__":
    main()
