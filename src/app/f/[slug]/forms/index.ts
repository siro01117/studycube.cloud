// 슬러그 → 화면 컴포넌트 정적 매핑. 동적 import 문자열 조합 금지(빌드 타임에 전부 드러나야 함).
// 새 설문 추가 시 여기에도 한 줄 추가.
import type { ComponentType } from "react";
import type { FormDef } from "../../registry";
import SurveySample from "./svq82fk1";
import ScheduleForm from "./sch9m2vt";
import LunchForm from "./lch4k9wp";
import ScheduleRequestForm from "./exr8k3mq";
import MyScheduleView from "./myts7fq2";
import MyAttendanceView from "./myat4wkd";
import MyPenaltyView from "./mypt9rxb";

export const FORM_COMPONENTS: Record<string, ComponentType<{ def: FormDef }>> = {
  svq82fk1: SurveySample,
  sch9m2vt: ScheduleForm,
  lch4k9wp: LunchForm,
  exr8k3mq: ScheduleRequestForm,
  myts7fq2: MyScheduleView,
  myat4wkd: MyAttendanceView,
  mypt9rxb: MyPenaltyView,
};
