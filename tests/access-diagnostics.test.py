"""Check credential compatibility and reject stale/disabled production access."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("access_diagnostics", ROOT / "scripts/access-diagnostics.py")
ACCESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ACCESS)


class AccessChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Generate the fixture with Node's exact production scrypt defaults.
        result = subprocess.run(["node", "-e", "const {scryptSync}=require('node:crypto');"
                                 "console.log(JSON.stringify('fixture-salt:'+"
                                 "scryptSync('fixture-password','fixture-salt',64).toString('hex')))"],
                                capture_output=True, text=True, check=True)
        cls.encoded = json.loads(result.stdout)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "教师 项目"
        (self.root / "tmp").mkdir(parents=True)
        self.downloads = self.root / "Downloads"
        self.downloads.mkdir()
        self.database = self.root / "live.db"
        connection = sqlite3.connect(self.database)
        connection.executescript('''
            CREATE TABLE Teacher(id TEXT, username TEXT, displayName TEXT, passwordHash TEXT);
            CREATE TABLE Classroom(id TEXT, teacherId TEXT, name TEXT, joinCode TEXT,
                joinOpen INTEGER, dataSource TEXT, createdAt TEXT);
            CREATE TABLE Learner(classroomId TEXT, number TEXT, recoveryHash TEXT, active INTEGER);
        ''')
        connection.execute("INSERT INTO Teacher VALUES (?,?,?,?)",
                           ("t1", "actual_teacher", "真实账号", self.encoded))
        connection.execute("INSERT INTO Classroom VALUES (?,?,?,?,?,?,?)",
                           ("c1", "t1", "演示课堂", "CLASS123", 1, "demo", "2026-01-01"))
        for number, recovery, active in [("L001", "fixture-recovery", 1),
                                         ("L002", "disabled-recovery", 0)]:
            connection.execute("INSERT INTO Learner VALUES (?,?,?,?)",
                               ("c1", number, hashlib.sha256(recovery.encode()).hexdigest(), active))
        connection.commit()
        connection.close()
        self.before = self.database.read_bytes()

    def diagnose(self):
        output = io.StringIO()
        connection = ACCESS.connect_readonly(self.database)
        try:
            with contextlib.redirect_stdout(output):
                summary = ACCESS.verify_access(connection, self.root, self.downloads)
        finally:
            connection.close()
        self.assertEqual(self.before, self.database.read_bytes())
        return output.getvalue(), "\n".join(summary)

    def test_node_password_compatibility(self):
        self.assertTrue(ACCESS.password_matches("fixture-password", self.encoded))
        self.assertFalse(ACCESS.password_matches("old-password", self.encoded))
        self.assertFalse(ACCESS.password_matches("fixture-password", "invalid"))

    def test_only_matching_actual_teacher_password_is_shown(self):
        (self.root / "tmp/teacher-access-actual_teacher.txt").write_text(
            "账户 actual_teacher\n密码 fixture-password\n", encoding="utf-8")
        (self.root / "tmp/teacher-access-teacher.txt").write_text(
            "账户 teacher\n密码 stale-secret\n", encoding="utf-8")
        output, summary = self.diagnose()
        self.assertIn("密码：fixture-password", output)
        self.assertNotIn("stale-secret", output + summary)
        self.assertNotIn("fixture-password", summary)
        self.assertIn("教师凭据匹配 1 个；旧凭据不匹配 1 个", summary)

    def test_stale_teacher_file_does_not_supply_password(self):
        (self.root / "tmp/teacher-access-actual_teacher.txt").write_text(
            "账户 actual_teacher\n密码 expired-secret\n", encoding="utf-8")
        output, summary = self.diagnose()
        self.assertIn("需定向恢复", output)
        self.assertNotIn("expired-secret", output + summary)

    def test_student_csv_validates_recovery_class_code_and_active_flag(self):
        (self.downloads / "learning-cards (1).csv").write_text(
            "\ufeff班级码,匿名学习编号,私密恢复码\n"
            "CLASS123,L001,wrong-recovery\n"
            "OLDCLASS,L001,fixture-recovery\n"
            "CLASS123,L002,disabled-recovery\n"
            "CLASS123,L001,fixture-recovery\n", encoding="utf-8")
        output, summary = self.diagnose()
        self.assertIn("恢复码：fixture-recovery", output)
        self.assertIn("演示课堂（demo）", output)
        self.assertNotIn("wrong-recovery", output + summary)
        self.assertNotIn("disabled-recovery", output + summary)
        self.assertNotIn("fixture-recovery", summary)
        self.assertIn("覆盖 1 个班级；失效卡 2 张；课堂关闭或卡停用 1 张", summary)

    def test_closed_classroom_does_not_offer_valid_card(self):
        connection = sqlite3.connect(self.database)
        connection.execute("UPDATE Classroom SET joinOpen=0")
        connection.commit()
        connection.close()
        self.before = self.database.read_bytes()
        (self.root / "tmp/demo-student-access.txt").write_text(
            "班级码 CLASS123\n匿名编号 L001\n恢复码 fixture-recovery\n", encoding="utf-8")
        output, summary = self.diagnose()
        self.assertNotIn("恢复码：fixture-recovery", output)
        self.assertIn("未开放", output)
        self.assertIn("课堂关闭或卡停用 1 张", summary)

    def test_readonly_connection_cannot_change_or_create_database(self):
        connection = ACCESS.connect_readonly(self.database)
        try:
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("DELETE FROM Teacher")
        finally:
            connection.close()
        missing = self.root / "missing.db"
        with self.assertRaises(sqlite3.OperationalError):
            ACCESS.connect_readonly(missing)
        self.assertFalse(missing.exists())

    def test_only_process_open_database_is_selected(self):
        unrelated = self.root / "backup.db"
        unrelated.write_bytes(self.before)
        opened = "p321\nf8\nn%s\n" % self.database
        with patch.object(ACCESS, "command", return_value=opened):
            self.assertEqual(ACCESS.running_databases([321]), [self.database.resolve()])
        with patch.object(ACCESS, "command", return_value=""):
            self.assertEqual(ACCESS.running_databases([321]), [])

    def test_multiple_open_databases_remain_ambiguous(self):
        other = self.root / "other.db"
        other.write_bytes(self.before)
        opened = "p321\nn%s\nn%s\n" % (self.database, other)
        with patch.object(ACCESS, "command", return_value=opened):
            self.assertEqual(len(ACCESS.running_databases([321])), 2)


if __name__ == "__main__":
    unittest.main()
