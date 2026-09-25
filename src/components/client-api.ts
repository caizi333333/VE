export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error ?? `请求失败（${response.status}）`);
  return value as T;
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "请求暂时未完成，请重试。";
export const statusLabel = (status: string) =>
  ({
    generating: "正在生成待审指导",
    pending_review: "等待教师审核",
    manual_pending: "等待教师处理",
    released: "已发布指导",
    rejected: "请补充后提交",
    confirmed: "教师已确认",
    needs_revision: "需要修订",
    pending: "等待验证",
    submitted: "等待教师验证",
  })[status] ?? status;
export const displayTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
