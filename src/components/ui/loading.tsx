import { LissajousLoader } from "../lissajous-loader";
import "./loading.css";

function Loading({ text }: { text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-zinc-900 text-white" role="status">
      <div aria-hidden="true" className="w-[72px] shrink-0">
        <LissajousLoader size={72} />
      </div>
      <p className="loading-shimmer text-center text-sm tracking-tight">{text}</p>
    </div>
  );
}

export { Loading };
