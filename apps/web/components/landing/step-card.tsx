interface CardStepProps {
  step: number;
  title: string;
  detail: string;
}

export function CardStep({ step, title, detail }: CardStepProps) {
  return (
    <div className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-100/0 via-brand-100/20 to-brand-200/30 opacity-0 transition group-hover:opacity-100" />
      <div className="relative flex flex-col gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white shadow-sm">
          {step}
        </span>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="text-sm leading-relaxed text-slate-600">{detail}</p>
      </div>
    </div>
  );
}
