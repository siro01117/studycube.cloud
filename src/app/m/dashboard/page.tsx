import { redirect } from "next/navigation";

// 종합 대시보드는 홈으로 합쳐졌다(집주인 지시 — "홈이 곧 대시보드"). 이 경로로 들어오는 기존
// 북마크·링크가 죽지 않도록 리다이렉트만 남긴다. 실제 화면·쿼리는 src/app/home/** 에 있다
// (지표 정의는 src/app/home/nowActions.ts 하나뿐 — DESIGN.md §9).
export default function DashboardRedirect() {
  redirect("/home");
}
