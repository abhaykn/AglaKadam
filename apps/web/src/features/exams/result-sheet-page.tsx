import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, Printer, Share2, Undo2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { BackLink } from '@/components/ui/back-link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { classDetailsQuery } from '@/features/attendance/attendance-api';
import { formatNoteTime } from '@/features/class-notes/note-format';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import { Badge } from '@/components/ui/badge';
import { workspacesOf } from '@/features/auth/access';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { examName, subjectName } from './exam-change';
import { examResultQuery, examRollQuery, type ExamSummary } from './exam-api';
import { formatMarks, type MarkEntry } from './marks';
import { resultShareDedupeKey, resultShareChange } from './result-share';
import { resultShareQuery, useShareResult } from './result-share-api';
import { sheetRows, type SheetRow } from './result-sheet';

/**
 * Whether the families of the class see this result yet, and the control to share it or take it
 * back. Children with a paper still unmarked are pointed out before sharing.
 */
function ShareWithFamilies({
  examId,
  classSectionId,
  schoolId,
  exam,
  rows,
}: {
  examId: string;
  classSectionId: string;
  schoolId: string;
  exam: { kind: ExamSummary['kind']; title: string };
  rows: readonly SheetRow[];
}) {
  const { t, i18n } = useTranslation();
  const share = useQuery(resultShareQuery(examId, classSectionId));
  const shareResult = useShareResult();
  const unmarked = rows.filter((row) => row.results.some((result) => result === null)).length;
  const change = (shared: boolean) =>
    void shareResult({
      examId,
      classSectionId,
      schoolId,
      shared,
      kind: exam.kind,
      title: exam.title,
    });
  const waiting = useWaitingChange(resultShareDedupeKey(examId, classSectionId));
  const waitingShare = resultShareChange.schema.safeParse(waiting.payload);
  const pending = waiting.isLoaded && waiting.state !== null && waitingShare.success;
  // Until the server has it, the change waiting on the phone is what the teacher decided.
  if (share.isPending && !pending) {
    return null;
  }
  const shared = pending
    ? waitingShare.data.shared
      ? { sharedAt: share.data?.sharedAt ?? null }
      : null
    : share.data
      ? { sharedAt: share.data.sharedAt }
      : null;
  return (
    <Card aria-labelledby="share-result" className="print:hidden">
      <CardHeader
        titleId="share-result"
        title={t('exams.share.title')}
        description={
          <>
            {shared
              ? shared.sharedAt
                ? t('exams.share.sharedOn', {
                    time: formatNoteTime(shared.sharedAt, i18n.language),
                  })
                : t('exams.share.sharing')
              : t('exams.share.notShared')}
            {pending ? (
              <>
                {' '}
                <Badge tone="warning">{t('exams.share.waiting')}</Badge>
              </>
            ) : null}
          </>
        }
        actions={
          shared ? (
            <Button variant="secondary" onClick={() => change(false)}>
              <Undo2 aria-hidden="true" />
              {t('exams.share.takeBack')}
            </Button>
          ) : (
            <Button onClick={() => change(true)}>
              <Share2 aria-hidden="true" />
              {t('exams.share.share')}
            </Button>
          )
        }
      />
      {!shared && unmarked > 0 ? (
        <CardBody>
          <Alert tone="warning">{t('exams.share.unmarked', { count: unmarked })}</Alert>
        </CardBody>
      ) : null}
    </Card>
  );
}

/** An exam's results for one class, ready to print as the school's result sheet. */
export function ResultSheetPage({
  classSectionId,
  examId,
}: {
  classSectionId: string;
  examId: string;
}) {
  const { t, i18n } = useTranslation();
  const localise = useLocalisedName();
  const access = useCurrentAccess();
  const result = useQuery(examResultQuery(examId, classSectionId));
  const details = useQuery(classDetailsQuery(classSectionId));
  const exam = result.data?.exam;
  const roster = useQuery({
    ...examRollQuery(classSectionId, exam?.startsOn ?? '', exam?.endsOn ?? ''),
    enabled: exam !== undefined,
  });
  useDocumentTitle(t('exams.result.title'));

  // Teachers go back to the class's exams; a CRP to the cluster's.
  const back = workspacesOf(access).includes('teacher') ? (
    <BackLink
      to="/app/exams/$classId"
      params={{ classId: classSectionId }}
      className="print:hidden"
    >
      {t('exams.marks.back')}
    </BackLink>
  ) : (
    <BackLink to="/app/crp/exams" className="print:hidden">
      {t('exams.marks.back')}
    </BackLink>
  );

  const data = result.data;
  if (!data) {
    return (
      <div className="container-page space-y-5 py-8">
        {back}
        <QueryState
          isPending={result.isPending}
          isError={result.isError}
          onRetry={() => void result.refetch()}
        >
          <EmptyState icon={FileSpreadsheet} title={t('exams.result.notFound')} />
        </QueryState>
      </div>
    );
  }

  const { papers } = data;
  const during = roster.data ?? [];
  const names = new Map<string, string>();
  for (const entry of roster.data ?? []) {
    names.set(entry.studentId, entry.fullName);
  }
  const ids = new Set([
    ...during.map((entry) => entry.studentId),
    ...papers.flatMap((paper) => paper.marks.map((mark) => mark.studentId)),
  ]);
  const children = [...ids]
    .map((studentId) => ({
      studentId,
      name: names.get(studentId) ?? t('exams.check.unnamed'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const rows = sheetRows(papers, children);
  const className = details.data
    ? classLabel(t, details.data.grade, details.data.section)
    : t('exams.classFallback');
  const description = t('exams.result.description', {
    exam: examName(data.exam, t),
    class: className,
    school: details.data ? localise(details.data.school) : '',
  });

  const cell = (entry: MarkEntry | null) => {
    if (!entry) {
      return t('exams.result.missing');
    }
    if (entry.absent) {
      return t('exams.result.absentShort');
    }
    return entry.marks !== null
      ? formatMarks(entry.marks, i18n.language)
      : (entry.grade ?? t('exams.result.missing'));
  };

  const table = (
    <table className="w-full min-w-max border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left">
          <th scope="col" className="px-3 py-2 font-semibold">
            {t('exams.result.child')}
          </th>
          {papers.map((paper) => (
            <th key={paper.id} scope="col" className="px-3 py-2 text-center font-semibold">
              {subjectName(paper, t)}
              <span className="block text-xs font-normal text-fg-muted">
                {paper.scale === 'marks' ? `/${String(paper.maxMarks ?? 0)}` : 'A–E'}
              </span>
            </th>
          ))}
          <th scope="col" className="px-3 py-2 text-center font-semibold">
            {t('exams.result.total')}
          </th>
          <th scope="col" className="px-3 py-2 text-center font-semibold">
            {t('exams.result.percent')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.studentId} className="border-b border-border">
            <th scope="row" className="px-3 py-2 text-left font-medium">
              {row.name}
            </th>
            {papers.map((paper, index) => (
              <td key={paper.id} className="px-3 py-2 text-center tabular-nums">
                {cell(row.results[index] ?? null)}
              </td>
            ))}
            <td className="px-3 py-2 text-center tabular-nums">
              {row.total !== null && row.outOf !== null
                ? `${formatMarks(row.total, i18n.language)}/${String(row.outOf)}`
                : t('exams.result.missing')}
            </td>
            <td className="px-3 py-2 text-center tabular-nums">
              {row.percent !== null
                ? formatMarks(row.percent, i18n.language)
                : t('exams.result.missing')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="container-page space-y-5 py-8">
      {back}
      <PageHeader
        title={t('exams.result.title')}
        description={description}
        actions={
          papers.length > 0 ? (
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              {t('exams.result.print')}
            </Button>
          ) : null
        }
      />
      {papers.length > 0 && details.data ? (
        <ShareWithFamilies
          examId={examId}
          classSectionId={classSectionId}
          schoolId={details.data.school.id}
          exam={data.exam}
          rows={rows}
        />
      ) : null}
      {papers.length === 0 ? (
        <EmptyState icon={FileSpreadsheet} title={t('exams.result.noPapers')} />
      ) : (
        <Card>
          <CardBody className="space-y-3">
            <div className="overflow-x-auto">{table}</div>
            <p className="text-sm text-fg-muted">{t('exams.result.totalNote')}</p>
          </CardBody>
        </Card>
      )}
      {papers.length > 0
        ? createPortal(
            <div className="ak-print-root ak-print-sheet" aria-hidden="true">
              <h1 className="ak-print-title">{t('exams.result.title')}</h1>
              <p>{description}</p>
              {table}
              <p>{t('exams.result.totalNote')}</p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
