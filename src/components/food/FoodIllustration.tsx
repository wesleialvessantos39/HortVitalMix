import type { z } from "zod";
import type { FoodIllustrationSchema } from "../../../shared/contracts/foodSafety";
type Kind = z.infer<typeof FoodIllustrationSchema>;
export function FoodIllustration({kind}:{kind:Kind}) {
  return <svg className="food-illustration" viewBox="0 0 240 160" fill="none" aria-hidden="true">
    <ellipse cx="120" cy="141" rx="88" ry="9" fill="var(--theme-green-soft, #e8f3e5)"/>
    <g stroke="var(--theme-green-ink, #1b4d2e)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      {(kind==="wash" || kind==="water") && <>
        <path d="M38 107h164l-13 28H51Z" fill="var(--surface, #fff)"/><path d="M65 38h30a13 13 0 0 1 13 13v13H88V54H65V38Z" fill="var(--theme-warm-soft, #fff0df)"/>
        <path d="M53 38V26m-9 0h18M88 73v9m14-9v9m-8 4v9" stroke="var(--splash-accent, #e65100)"/>
        {kind==="wash" ? <><path d="m62 109 24-17 10 6 16-16 9 7-15 22 22-7 9 11-30 14H84Z" fill="var(--theme-warm-soft, #fff0df)"/><path d="m120 98 20-8 18 15 23 5-8 18-28-8-18-11" fill="var(--theme-warm-soft, #fff0df)"/><circle cx="144" cy="76" r="5"/><circle cx="159" cy="82" r="3"/></> : <><path d="M135 75c-28 11-30 43-9 51 22 8 40-25 30-47-6 12-12 14-21-4Z" fill="var(--theme-green-soft, #e8f3e5)"/><path d="m129 117 21-29"/><path d="M176 46c0 9-14 17-14 25a14 14 0 0 0 28 0c0-8-14-16-14-25Z" fill="var(--theme-warm-soft, #fff0df)"/></>}
      </>}
      {kind==="cold" && <>
        <rect x="49" y="22" width="102" height="114" rx="10" fill="var(--surface, #fff)"/><path d="M49 67h102M61 41v14m0 27v19"/>
        <path d="M111 43h-21m10-10v21m-8-18 16 16m0-16-16 16" stroke="#e65100"/>
        <path d="M176 54a8 8 0 0 1 16 0v49a16 16 0 1 1-16 0Z" fill="var(--theme-warm-soft, #fff0df)"/><path d="M184 77v39" stroke="#e65100"/><circle cx="184" cy="118" r="5" fill="#e65100" stroke="none"/>
        <path d="M87 114c-9-14-2-30 18-27 2 17-6 27-18 27Z" fill="var(--theme-green-soft, #e8f3e5)"/>
      </>}
      {kind==="label" && <>
        <rect x="55" y="30" width="130" height="104" rx="14" fill="var(--surface, #fff)"/><path d="M55 55h130"/><path d="M72 48c1-13 14-20 27-16 0 14-11 20-27 16Z" fill="var(--theme-green-soft, #e8f3e5)"/>
        <rect x="78" y="67" width="84" height="51" rx="5" fill="var(--theme-warm-soft, #fff0df)"/><path d="M89 78h61m-61 10h40m-40 10h61m-61 10h30"/>
        <circle cx="174" cy="33" r="18" fill="#e65100" stroke="none"/><path d="m165 33 6 6 13-13" stroke="#fff"/>
      </>}
      {kind==="trace" && <>
        <path d="M20 91h49v40H20Zm75-32h50v49H95Zm77 32h48v40h-48Z" fill="var(--surface, #fff)"/>
        <path d="M42 77V59c-13 2-17-6-17-17 13-1 18 5 17 17 11-8 24-4 27 2-10 9-20 8-27 3" fill="var(--theme-green-soft, #e8f3e5)"/>
        <path d="m74 100 11-11m-8 0h8v8m66-8 13 12m-8 0h8v-8" stroke="#e65100"/>
        <path d="M108 73h23m-23 10h23m-23 10h14M188 103h16m-16 9h16"/>
      </>}
      {kind==="environment" && <>
        <path d="M68 56h57l-7 77H75Z" fill="var(--surface, #fff)"/><path d="M61 55h73M79 42h34v13m-27 15v46m22-46v46"/>
        <path d="m162 54 14-20 15 23m-5-9h13m-1 1-10 10m14 17 7 24-28 1m10 0-7 11m-1-3-2-11m-21 8-24-8 12-25m-4 9-12-1m2 2 10-9" stroke="#e65100"/>
        <path d="M157 133c-9-13-2-32 18-29 3 17-4 27-18 29Z" fill="var(--theme-green-soft, #e8f3e5)"/>
      </>}
      {kind==="license" && <>
        <rect x="64" y="27" width="108" height="108" rx="9" fill="var(--surface, #fff)"/><path d="M93 27v-7h52v15H93Z" fill="var(--theme-warm-soft, #fff0df)"/><path d="M88 53h57m-57 15h39m-39 15h57m-57 15h33"/>
        <circle cx="164" cy="109" r="25" fill="var(--theme-green-soft, #e8f3e5)"/><path d="m150 109 9 9 20-22" stroke="#e65100"/>
      </>}
    </g>
  </svg>;
}
