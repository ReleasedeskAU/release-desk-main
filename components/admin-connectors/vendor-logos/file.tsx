import type { IconProps } from "./icon-props";

const SvgFile = ({ size = 32, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path
      d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
      fill="#E5E7EB"
      stroke="#6B7280"
      strokeWidth="1.4"
    />
    <path d="M14 3v5h5" stroke="#6B7280" strokeWidth="1.4" />
  </svg>
);
export default SvgFile;
