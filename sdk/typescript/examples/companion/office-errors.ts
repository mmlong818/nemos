/**
 * 明确写给用户看的错误。
 *
 * 服务端对 4xx/5xx 的错误正文一律脱敏，避免把异常原文和内部路径抛给前端。
 * 但"文件已被其他程序修改""单个文件不能超过 8 MB"这类提示是用户唯一的下一步依据，
 * 被脱敏掉就只剩一句无用的通用文案。因此用这个类型把两者区分开：
 * 只有这里抛出的消息允许原样显示，其余异常照旧脱敏。
 *
 * 新增消息前先确认它不含文件系统路径、内部编号或依赖库的原始报错。
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function userFacingMessage(error: unknown): string | undefined {
  return error instanceof UserFacingError ? error.message : undefined;
}
