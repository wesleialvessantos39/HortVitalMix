import type { CategoryIconName } from "../../../shared/contracts/category";
import type { ReactNode } from "react";

const paths: Record<CategoryIconName, ReactNode> = {
  leaf: (
    <>
      <path d="M20 3c-7 0-15 2-15 10a6 6 0 0 0 6 6c8 0 9-9 9-16Z" />
      <path d="m3 21 12-12" />
    </>
  ),
  knife: (
    <>
      <path d="M18 3c-5 2-9 6-10 10l4 3 9-12-3-1Z" />
      <path d="m9 14-6 6 2 2 7-6" />
    </>
  ),
  bowl: (
    <>
      <path d="M3 11h18c0 6-4 9-9 9s-9-3-9-9Z" />
      <path d="M8 22h8M8 3c-2 2 2 3 0 5m5-5c-2 2 2 3 0 5m5-5c-2 2 2 3 0 5" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3Z" />
      <path d="M21 2v4m-2-2h4M3 19v4m-2-2h4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  carrot: (
    <>
      <path d="M3 21c1-6 3-13 7-13 5 0 7 3 5 6S8 19 3 21Z" />
      <path d="m8 11 3 3m1-6 3-5m0 6 6-1m-5 3 4 3" />
    </>
  ),
  basket: (
    <>
      <path d="m3 10 2 10h14l2-10H3Zm4 0 5-7 5 7M9 13v4m6-4v4" />
    </>
  ),
};

export function CategoryIcon({
  name,
  size = 22,
}: {
  name: CategoryIconName;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
