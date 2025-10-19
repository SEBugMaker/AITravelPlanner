import { CardStep } from "./step-card";

const steps = [
  {
    step: 1,
    title: "采集需求",
    detail: "语音/文字填表，自动识别成员、预算、兴趣标签，并存入 Supabase。"
  },
  {
    step: 2,
    title: "AI 生成行程",
    detail: "调用通义千问，按天生成交通、住宿、餐饮、活动并打上预算标签。"
  },
  {
    step: 3,
    title: "地图/预算联动",
    detail: "高德地图绘制线路，预算面板同步展示每日支出和预警。"
  },
  {
    step: 4,
    title: "实时协同",
    detail: "家人或同事可实时查看最新安排，Edge Functions 推送提醒。"
  }
];

export function HowItWorksSection() {
  return (
    <section className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-900">工作流一览</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((entry) => (
          <CardStep key={entry.step} {...entry} />
        ))}
      </div>
    </section>
  );
}
