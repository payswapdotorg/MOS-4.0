import { cn } from "@/components/lib/utils.js";

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="118"
      height="100"
      fill="none"
      viewBox="0 0 256 218"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M30 218 V18 H72 L128 118 L184 18 H226 V218 H186 V92 L146 168 H110 L70 92 V218 Z"
      />
    </svg>
  );
}

export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return (
    <svg
      width="244"
      height="54"
      viewBox="0 0 244 54"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 44 V8 H18 L30 28 L42 8 H52 V44 H43 V22 L33.5 38 H26.5 L17 22 V44 Z"
      />
      <text
        x="62"
        y="38"
        fill="currentColor"
        font-size="32"
        font-weight="700"
        letter-spacing="0.5"
      >
        MOS 4.0
      </text>
    </svg>
  );
}
