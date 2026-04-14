-- ================================================================
-- Migration: personal_schedules + navigation restructure (v2)
-- ================================================================
-- 변경 내용:
--   1. personal_schedules 테이블 생성 (선생님/학생 개인 일정)
--   2. roles 권한 업데이트:
--      - admin:   full-schedule 모듈 추가, schedule/apply 카테고리 추가
--      - manager: schedule/apply 카테고리 추가
--      - user:    user 카테고리 → schedule + apply 카테고리로 교체
-- ================================================================


-- ----------------------------------------------------------------
-- 1. personal_schedules 테이블
--    선생님·학생 공통 개인 블록 (수업 외 개인 일정, 상담 예약 등)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personal_schedules (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  title        text        NOT NULL,                          -- 표시 제목 (예: "수학 준비", "개인 상담")
  color        text,                                          -- hex 색상 (#5badff 등), null이면 역할 기본색

  -- 반복 일정 (매주)
  day          day_of_week,                                   -- 반복 요일 (null이면 특정 날짜)
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,

  -- 특정 날짜 일정 (day가 null일 때 사용)
  specific_date date,                                         -- 반복이 아닌 특정 날짜

  notes        text,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- day 또는 specific_date 중 하나는 반드시 있어야 함
  CONSTRAINT chk_day_or_date CHECK (day IS NOT NULL OR specific_date IS NOT NULL)
);

-- 시간 역전 방지
ALTER TABLE personal_schedules
  ADD CONSTRAINT chk_time_order CHECK (end_time > start_time);

-- RLS 활성화
ALTER TABLE personal_schedules ENABLE ROW LEVEL SECURITY;

-- 본인 일정만 전체 접근
DROP POLICY IF EXISTS "personal_schedules: 본인 전체 접근" ON personal_schedules;
CREATE POLICY "personal_schedules: 본인 전체 접근"
  ON personal_schedules FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- admin/manager: 전체 조회 (학생 시간표 열람 등)
DROP POLICY IF EXISTS "personal_schedules: admin/manager 전체 조회" ON personal_schedules;
CREATE POLICY "personal_schedules: admin/manager 전체 조회"
  ON personal_schedules FOR SELECT
  USING (get_my_role() IN ('admin', 'manager'));

-- updated_at 자동 갱신 함수
CREATE OR REPLACE FUNCTION update_personal_schedules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_personal_schedules_updated_at ON personal_schedules;
CREATE TRIGGER trg_personal_schedules_updated_at
  BEFORE UPDATE ON personal_schedules
  FOR EACH ROW EXECUTE FUNCTION update_personal_schedules_updated_at();


-- ----------------------------------------------------------------
-- 2. 역할 권한 업데이트 (navigation restructure)
--    카테고리 변경:
--      - user  → schedule + apply  (학생 포털 재구성)
--      - admin → full-schedule 모듈 추가, schedule/apply 추가
--      - manager → schedule/apply 추가
-- ----------------------------------------------------------------

-- admin 역할: full-schedule + schedule/apply 추가
UPDATE roles
SET
  permissions = jsonb_build_object(
    'admin',          ARRAY['users', 'full-schedule'],
    'manager',        ARRAY['classroom-schedule', 'attendance', 'lunch', 'courses'],
    'student-manage', ARRAY['students-register', 'students-schedule', 'students-assignments'],
    'schedule',       ARRAY['my-schedule', 'student-list', 'assignments'],
    'apply',          ARRAY['student-lunch', 'student-enroll']
  ),
  category_order = ARRAY['admin', 'manager', 'student-manage', 'schedule', 'apply']
WHERE name = 'admin';

-- manager 역할: schedule/apply 추가 (학생들 시간표도 관리 가능하도록)
UPDATE roles
SET
  permissions = jsonb_build_object(
    'manager',        ARRAY['classroom-schedule', 'attendance', 'lunch', 'courses'],
    'student-manage', ARRAY['students-register', 'students-schedule', 'students-assignments'],
    'schedule',       ARRAY['my-schedule', 'student-list', 'assignments'],
    'apply',          ARRAY['student-lunch', 'student-enroll']
  ),
  category_order = ARRAY['manager', 'student-manage', 'schedule', 'apply']
WHERE name = 'manager';

-- user(학생) 역할: user 카테고리 → schedule + apply
UPDATE roles
SET
  permissions = jsonb_build_object(
    'schedule', ARRAY['my-schedule', 'assignments'],
    'apply',    ARRAY['student-lunch', 'student-enroll']
  ),
  category_order = ARRAY['schedule', 'apply']
WHERE name = 'user';


-- ----------------------------------------------------------------
-- 완료 확인
-- ----------------------------------------------------------------
-- SELECT name, label, category_order FROM roles;
-- SELECT * FROM personal_schedules LIMIT 5;
