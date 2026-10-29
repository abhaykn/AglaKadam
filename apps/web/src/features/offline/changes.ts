/**
 * Every kind of change that can wait on the device. Imported when the application starts, so that
 * changes saved earlier are sent even before the screens that made them are opened again.
 */
import '@/features/attendance/attendance-change';
import '@/features/class-notes/note-change';
import '@/features/consent/consent-change';
import '@/features/exams/exam-change';
import '@/features/exams/result-share';
import '@/features/pulse/pulse-change';
import '@/features/visits/visit-change';
