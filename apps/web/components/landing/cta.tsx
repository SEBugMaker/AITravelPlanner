import Link from "next/link";
import { Button } from "@ui/button";

export function CTASection() {
  return (
    <section className="rounded-3xl border border-slate-200 bg-slate-900 px-6 py-12 text-white shadow-lg sm:px-12">
      <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">准备好让 AI 帮你搞定旅行计划了吗？</h2>
          <p className="mt-2 text-sm text-slate-200">
            立即体验语音行程规划、预算提醒与实时地图辅助，支持家庭/团队共享。
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/planner"
            className="inline-flex items-center justify-center rounded-full bg-white px-6 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
          >
            免费开始
          </Link>
          <Button variant="secondary" className="border-white/40 px-6 py-2 text-white hover:border-white/80">
            预约演示
          </Button>
        </div>
      </div>
    </section>
  );
}
