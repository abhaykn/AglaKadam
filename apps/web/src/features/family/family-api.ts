import { queryOptions } from '@tanstack/react-query';
import { todayInIndia } from '@shared/accounts.ts';
import { EXAM_KINDS, SUBJECTS, type ExamKind, type Subject } from '@/features/exams/exam-change';
import { GRADES, type Grade } from '@/features/exams/marks';
import { getSupabase } from '@/lib/supabase';
import { sessionStart, type AttendanceDay } from './attendance-summary';
import { childExams, type ChildExam } from './results';

/**
 * What a family reads about its own child. The database shows a family only its child's records:
 * marks of results the school has shared, and the child's own days of attendance.
 */

export const familyResultsKey = (studentId: string) => ['family-results', studentId] as const;
export const familyAttendanceKey = (studentId: string) => ['family-attendance', studentId] as const;

function kindOf(value: string): ExamKind {
  return EXAM_KINDS.find((kind) => kind === value) ?? 'class_test';
}

function subjectOf(value: string): Subject {
  return SUBJECTS.find((subject) => subject === value) ?? 'other';
}

function gradeOf(value: string | null): Grade | null {
  return GRADES.find((grade) => grade === value) ?? null;
}

/** The child's results in the exams the school has shared, the latest exam first. */
export function familyResultsQuery(studentId: string) {
  return queryOptions({
    queryKey: familyResultsKey(studentId),
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ChildExam[]> => {
      const { data, error } = await getSupabase()
        .from('exam_marks')
        .select(
          'paper_id, marks, grade, absent, exam_papers!inner(subject, subject_name, held_on, scale, max_marks, exams!inner(id, kind, title, starts_on, ends_on))',
        )
        .eq('student_id', studentId);
      if (error) {
        throw error;
      }
      return childExams(
        data.map((row) => {
          const paper = row.exam_papers;
          const exam = paper.exams;
          return {
            paperId: row.paper_id,
            subject: subjectOf(paper.subject),
            subjectName: paper.subject_name,
            heldOn: paper.held_on,
            scale: paper.scale === 'grades' ? 'grades' : 'marks',
            maxMarks: paper.max_marks,
            marks: row.marks,
            grade: gradeOf(row.grade),
            absent: row.absent,
            exam: {
              id: exam.id,
              kind: kindOf(exam.kind),
              title: exam.title ?? '',
              startsOn: exam.starts_on,
              endsOn: exam.ends_on,
            },
          };
        }),
      );
    },
  });
}

/** The child's attendance in the current session, oldest day first. */
export function familyAttendanceQuery(studentId: string) {
  return queryOptions({
    queryKey: familyAttendanceKey(studentId),
    meta: { persist: true },
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AttendanceDay[]> => {
      const { data, error } = await getSupabase().rpc('my_attendance', {
        since: sessionStart(todayInIndia()),
      });
      if (error) {
        throw error;
      }
      return data.map((row) => ({ date: row.attendance_date, present: row.present }));
    },
  });
}
