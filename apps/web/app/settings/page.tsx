import type { Metadata } from "next";
import { SettingsShell } from "../../components/settings";

export const metadata: Metadata = {
  title: "配置中心 | AI Travel Planner",
  description: "管理行程规划默认项、密钥与第三方服务配置"
};

export default function SettingsPage() {
  return <SettingsShell />;
}
