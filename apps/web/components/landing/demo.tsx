import { createSkeletonPlan, summarizePreferences } from "@core/index";

const demoPreferences = {
  destination: "东京",
  days: 5,
  budgetCNY: 10000,
  companions: 3,
  interests: ["美食", "动漫", "亲子"]
};

const skeleton = createSkeletonPlan(demoPreferences);

export function DemoSection() {
  return (
    <section className="rounded-3xl border border-dashed border-brand-200 bg-white/70 p-6">
      <h3 className="text-lg font-semibold text-brand-600">示例行程骨架</h3>
      <p className="mt-3 text-sm text-slate-600">{summarizePreferences(demoPreferences)}</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {skeleton.dayPlans.map((plan) => (
          <div key={plan.day} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="font-semibold text-slate-900">第 {plan.day} 天</p>
            <p className="mt-1 text-sm text-slate-600">{plan.summary}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
