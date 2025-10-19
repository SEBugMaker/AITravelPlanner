import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const envFiles = [".env", ".env.local"];
for (const file of envFiles) {
  const fullPath = path.join(projectRoot, file);
  if (fs.existsSync(fullPath)) {
    dotenv.config({ path: fullPath, override: true });
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 环境变量，请先在根目录 .env 或 shell 中配置。"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

function parseArgs() {
  const args = process.argv.slice(2);
  let email = null;
  let userId = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--email" || arg === "-e") {
      email = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--user-id" || arg === "-u") {
      userId = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!email && !userId) {
    printUsage();
    console.error("必须提供 --email 或 --user-id 其中一个参数。");
    process.exit(1);
  }

  return { email, userId };
}

function printUsage() {
  console.log(`用法：pnpm --filter web run delete-user -- --email user@example.com
或： pnpm --filter web run delete-user -- --user-id <uuid>
脚本会在删除 Supabase Auth 用户前，先清理 itineraries 与 expense_records 中的关联数据。`);
}

async function resolveUserId({ email, userId }) {
  if (userId) {
    return userId;
  }

  const { data, error } = await supabase.auth.admin.listUsers({ search: email });
  if (error) {
    throw new Error(`查询用户失败：${error.message}`);
  }

  const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (!match) {
    throw new Error(`未找到邮箱为 ${email} 的用户。`);
  }

  return match.id;
}

async function deleteUserData(userId) {
  const { error: expenseError } = await supabase
    .from("expense_records")
    .delete()
    .eq("userId", userId);
  if (expenseError) {
    throw new Error(`删除消费记录失败：${expenseError.message}`);
  }

  const { error: itineraryError } = await supabase
    .from("itineraries")
    .delete()
    .eq("user_id", userId);
  if (itineraryError) {
    throw new Error(`删除行程数据失败：${itineraryError.message}`);
  }
}

async function deleteAuthUser(userId) {
  const { error } = await supabase.auth.admin.deleteUser(userId, false);
  if (error) {
    throw new Error(`删除 Supabase Auth 用户失败：${error.message}`);
  }
}

async function main() {
  try {
    const { email, userId: rawUserId } = parseArgs();
    const userId = await resolveUserId({ email, userId: rawUserId });

    console.log(`准备删除用户 ${email ?? userId}（ID: ${userId}）。`);

    await deleteUserData(userId);
    await deleteAuthUser(userId);

    console.log("✅ 用户及其关联行程/消费数据已删除。");
  } catch (error) {
    console.error("❌ 删除失败：", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
