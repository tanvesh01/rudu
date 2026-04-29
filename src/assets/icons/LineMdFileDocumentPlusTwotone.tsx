import { SVGProps } from "react";

export function LineMdFileDocumentPlusTwotone(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      {/* Icon from Material Line Icons by Vjacheslav Trushkin - https://github.com/cyberalien/line-md/blob/master/license.txt */}
      <mask id="SVGLyKcJ83a">
        <g
          fill="none"
          stroke="#fff"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path
            fill="#fff"
            fillOpacity="0"
            strokeDasharray="64"
            strokeDashoffset="64"
            d="M13.5 3l5.5 5.5v11.5c0 0.55 -0.45 1 -1 1h-12c-0.55 0 -1 -0.45 -1 -1v-16c0 -0.55 0.45 -1 1 -1Z"
          >
            <animate
              fill="freeze"
              attributeName="fill-opacity"
              begin="0.8s"
              dur="0.15s"
              values="0;0.3"
            />
            <animate
              fill="freeze"
              attributeName="stroke-dashoffset"
              dur="0.6s"
              values="64;0"
            />
          </path>
          <path d="M14.5 3.5l2.25 2.25l2.25 2.25z" opacity="0">
            <animate
              fill="freeze"
              attributeName="d"
              begin="0.6s"
              dur="0.2s"
              values="M14.5 3.5l2.25 2.25l2.25 2.25z;M14.5 3.5l0 4.5l4.5 0z"
            />
            <set fill="freeze" attributeName="opacity" begin="0.6s" to="1" />
          </path>
          <path strokeDasharray="8" strokeDashoffset="8" d="M9 13h6">
            <animate
              fill="freeze"
              attributeName="stroke-dashoffset"
              begin="1s"
              dur="0.2s"
              values="8;0"
            />
          </path>
          <path strokeDasharray="4" strokeDashoffset="4" d="M9 17h3">
            <animate
              fill="freeze"
              attributeName="stroke-dashoffset"
              begin="1.2s"
              dur="0.2s"
              values="4;0"
            />
          </path>
          <path
            fill="#000"
            fillOpacity="0"
            stroke="none"
            d="M19 13c3.31 0 6 2.69 6 6c0 3.31 -2.69 6 -6 6c-3.31 0 -6 -2.69 -6 -6c0 -3.31 2.69 -6 6 -6Z"
          >
            <set
              fill="freeze"
              attributeName="fill-opacity"
              begin="1.4s"
              to="1"
            />
          </path>
          <path strokeDasharray="8" strokeDashoffset="8" d="M16 19h6">
            <animate
              fill="freeze"
              attributeName="stroke-dashoffset"
              begin="1.4s"
              dur="0.2s"
              values="8;0"
            />
          </path>
          <path strokeDasharray="8" strokeDashoffset="8" d="M19 16v6">
            <animate
              fill="freeze"
              attributeName="stroke-dashoffset"
              begin="1.6s"
              dur="0.2s"
              values="8;0"
            />
          </path>
        </g>
      </mask>
      <rect
        width="24"
        height="24"
        fill="currentColor"
        mask="url(#SVGLyKcJ83a)"
      />
    </svg>
  );
}
export default LineMdFileDocumentPlusTwotone;
