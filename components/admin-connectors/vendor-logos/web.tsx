import type { IconProps } from "./icon-props";

const SvgWeb = ({ size = 32, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <circle cx="12" cy="12" r="9" stroke="#0EA5E9" strokeWidth="1.8" />
    <ellipse cx="12" cy="12" rx="4" ry="9" stroke="#0EA5E9" strokeWidth="1.8" />
    <path d="M3.5 12h17M5 8.2h14M5 15.8h14" stroke="#0EA5E9" strokeWidth="1.4" />
  </svg>
);
export default SvgWeb;
