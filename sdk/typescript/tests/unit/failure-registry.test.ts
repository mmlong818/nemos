import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CompanionFailure,
  UNREGISTERED_FAILURE_CODE,
  classifyFailure,
  describeFailure,
  failureShape,
  failureShapeByName,
  isRetryableFailure,
  listFailureShapes,
  redactFailureDetail,
} from "../../examples/companion/failure-registry.js";

// 相对包根：npm test 的工作目录就是 sdk/typescript，与其它测试读取 web 资源的写法一致。
const companionRoot = "examples/companion";
const sdkRoot = "src";

test("每条失败都有唯一编号、非空说明，且编号按域分段", () => {
  const shapes = listFailureShapes();
  assert.ok(shapes.length > 20);
  assert.equal(new Set(shapes.map((item) => item.code)).size, shapes.length);
  assert.equal(new Set(shapes.map((item) => item.name)).size, shapes.length);
  for (const shape of shapes) {
    assert.match(shape.code, /^CF-E\d{4}$/);
    assert.ok(shape.summary.length > 10, `${shape.code} 缺少后果说明`);
    assert.ok(shape.seededFrom.length > 10, `${shape.code} 缺少抛出点`);
    assert.equal(new Set(shape.payload).size, shape.payload.length);
    assert.equal(failureShape(shape.code), shape);
    assert.equal(failureShapeByName(shape.name), shape);
  }
});

// seededFrom 必须能反查到真实文件，否则「失败原因」重新变成猜测：
// 给还没实现的东西预留编号，是这套注册表最容易腐烂的方式。
test("每条失败的抛出点文件真实存在", () => {
  for (const shape of listFailureShapes()) {
    const file = / in ([\w./-]+\.ts)/.exec(shape.seededFrom)?.[1];
    if (!file) {
      assert.equal(shape.code, UNREGISTERED_FAILURE_CODE, `${shape.code} 的 seededFrom 没有指向文件`);
      continue;
    }
    const path = [join(companionRoot, file), join(sdkRoot, file)].find((candidate) => existsSync(candidate));
    assert.ok(path, `${shape.code} 的抛出点文件不存在：${file}`);
    // 文件在但函数被改名同样会让 seededFrom 说谎，所以点名的标识符也要还在。
    const symbol = new RegExp(`\\.ts\\s+([A-Za-z_$][\\w$]*)`).exec(shape.seededFrom)?.[1];
    if (symbol) {
      assert.ok(
        readFileSync(path, "utf8").includes(symbol),
        `${shape.code} 的抛出点 ${file} 里已经没有 ${symbol}`,
      );
    }
  }
});

test("未注册的失败被重分类，原始报错文本不外传", () => {
  const secret = "connect ECONNREFUSED 10.0.0.5:5432 api_key='sk-abcdefghijklmnop'";
  const report = classifyFailure(new Error(secret));
  assert.equal(report.code, UNREGISTERED_FAILURE_CODE);
  assert.equal(report.retryable, false);
  assert.deepEqual(report.payload, {});
  assert.doesNotMatch(JSON.stringify(report), /ECONNREFUSED|10\.0\.0\.5|sk-abcdef/);
  assert.equal(classifyFailure("字符串错误").code, UNREGISTERED_FAILURE_CODE);
  assert.equal(classifyFailure(undefined).code, UNREGISTERED_FAILURE_CODE);
});

test("已注册的失败保留自己的编号与可重试性，未声明的 payload 键被丢掉", () => {
  const failure = new CompanionFailure("CF-E0401", { attempts: 2, leaseMs: 30_000, internalPath: "C:/Users/me/secret" });
  const report = failure.report();
  assert.equal(report.code, "CF-E0401");
  assert.equal(report.retryable, true);
  // 未在注册表声明的键被丢掉，本机路径不会顺着失败上报流出去。
  assert.deepEqual(report.payload, { attempts: "2", leaseMs: "30000" });
  assert.doesNotMatch(JSON.stringify(report), /Users|secret/);
  assert.equal(classifyFailure(failure).code, "CF-E0401");
  assert.equal(isRetryableFailure("CF-E0401"), true);
  assert.equal(isRetryableFailure("CF-E0402"), false);
  assert.equal(isRetryableFailure("CF-E9999"), false);
});

test("未知编号走兜底而不是抛错，界面永远拿得到一条可显示的记录", () => {
  const report = describeFailure("CF-E9999", { anything: "value" });
  assert.equal(report.code, UNREGISTERED_FAILURE_CODE);
  assert.deepEqual(report.payload, {});
  assert.equal(new CompanionFailure("CF-E9999").code, UNREGISTERED_FAILURE_CODE);
});

test("payload 值也过脱敏，且长度有界", () => {
  const report = describeFailure("CF-E0701", { file: "Bearer sk-0123456789abcdef 写入 " + "x".repeat(400) });
  assert.match(report.payload.file!, /Bearer \[REDACTED\]/);
  assert.ok(report.payload.file!.length <= 200);
  assert.equal(redactFailureDetail('password: "hunter2"'), 'password: "[REDACTED]"');
  assert.equal(redactFailureDetail('refresh_token="abc"'), 'refresh_token="[REDACTED]"');
});
