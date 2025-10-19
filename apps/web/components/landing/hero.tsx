import Link from "next/link";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white px-6 py-16 shadow-sm sm:px-12">
      <div className="absolute right-0 top-0 hidden translate-x-1/3 translate-y-[-30%] rounded-full bg-brand-100/60 blur-3xl md:block" style={{ width: "420px", height: "420px" }} />
      <div className="relative max-w-3xl">
        <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-brand-100 px-4 py-1 text-sm font-medium text-brand-700">
          AI Travel Planner
        </span>
        <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
          语音 + AI 行程规划，一站完成预算、导航、实时提醒
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-slate-600">
          告诉我们目的地、天数、预算与偏好，AI 即刻生成交通、住宿、景点、美食的逐日安排。
          实时同步到云端，随时根据天气与花费自动调优。
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <Link
            href="/planner"
            className="inline-flex items-center justify-center rounded-full bg-brand-500 px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            立即创建行程
          </Link>
          <Link
            href="#features"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 px-6 py-2 text-sm font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:ring-offset-2"
          >
            查看功能演示
          </Link>
          <span className="text-sm text-slate-500">
            免费试用 · 支持家庭与团队协作
          </span>
        </div>
      </div>
    </section>
  );
}
