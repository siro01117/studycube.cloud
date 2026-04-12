-- ================================================
-- 상담 일정 지원을 위한 마이그레이션
-- 1. classroom_schedules.course_id → nullable
--    (수업 없이 상담 일정 추가 가능하도록)
-- 2. classroom_schedules.notes 컬럼 추가
--    (상담 시 학생 이름 등 메모 저장)
-- ================================================

-- 기존 NOT NULL 트리거/제약 때문에 course_id 참조 제거 후 재추가
ALTER TABLE classroom_schedules
  ALTER COLUMN course_id DROP NOT NULL;

-- notes 컬럼 추가 (없으면)
ALTER TABLE classroom_schedules
  ADD COLUMN IF NOT EXISTS notes text;

-- schedule_overrides에는 이미 memo 컬럼 있음 (상담 학생이름 저장 가능)

-- 기존 중복 방지 트리거는 유지 (course_id 무관하게 교실/요일/시간 기준 체크)
