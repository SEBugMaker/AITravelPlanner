import type { Metadata } from "next";
import { PlannerShell } from "../../components/planner";

export const metadata: Metadata = {
  title: "智能行程规划 | AI Travel Planner",
  description: "根据旅行偏好生成个性化行程，并自动估算预算、记录消费"
};

export default function PlannerPage() {
  return <PlannerShell />;
}
