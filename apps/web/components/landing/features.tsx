const featureCards = [
  {
    title: "语音秒记",
    description: "实时录音+阿里云语音识别，自动提取目的地、预算、偏好与风险提醒。",
    highlight: "语音/文字双通道"
  },
  {
    title: "智能行程",
    description: "通义千问生成每日路线、交通、餐饮与亲子友好推荐，可随时编辑。",
    highlight: "LLM 行程模板"
  },
  {
    title: "预算监管",
    description: "AI 预估与实际支出对比，异常超支发送提醒，支持多币种自动换算。",
    highlight: "实时费用预警"
  },
  {
    title: "云端协同",
    description: "Supabase Realtime 同步家庭/同伴的修改，跨设备查看、推送通知。",
    highlight: "多人协作"
  }
];

export function FeaturesSection() {
  return (
    <section id="features" className="grid gap-6 md:grid-cols-2">
      {featureCards.map((card) => (
        <article
          key={card.title}
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
        >
          <span className="inline-flex items-center rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-600">
            {card.highlight}
          </span>
          <h2 className="mt-4 text-xl font-semibold text-slate-900">{card.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{card.description}</p>
        </article>
      ))}
    </section>
  );
}
