-- ================================================
-- 누락된 컬럼 일괄 추가 마이그레이션
-- Supabase 대시보드 → SQL Editor에서 전체 실행
-- ================================================

-- 1. classrooms.description (교실 메모 저장)
--    이게 없으면 교실 메모가 저장되지 않음
ALTER TABLE classrooms
  ADD COLUMN IF NOT EXISTS description text;

-- 2. classroom_schedules.course_id → nullable
--    (수업 없는 상담 일정 추가 허용)
ALTER TABLE classroom_schedules
  ALTER COLUMN course_id DROP NOT NULL;

-- 3. classroom_schedules.notes (상담 학생이름 + 선생님이름 저장)
ALTER TABLE classroom_schedules
  ADD COLUMN IF NOT EXISTS notes text;
