import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { classRosterQuery } from '@/features/attendance/attendance-api';
import { formatDay } from '@/features/attendance/dates';
import { EnglishLevelLabel, ReadingLevelLabel } from '@/features/visits/visit-ui';
import { examName, subjectName } from './exam-change';
import { clusterExamsQuery, marksChecksQuery, marksPulseQuery, type MarksCheck } from './exam-api';
import { formatMarks } from './marks';

const ENGLISH_LEVELS = ['sentences', 'words', 'no_response'];

/**
 * For the CRP's class pack: the class's language papers with their marks beside Pulse. A pattern of
 * high marks and weak reading is shown as worth talking over; the children can be listed.
 */
export function MarksCheckCard({ classSectionId }: { classSectionId: string }) {
  const { t } = useTranslation();
  const checks = useQuery(marksChecksQuery());
  const ofClass = (checks.data ?? [])
    .filter((check) => check.classSectionId === classSectionId)
    .sort((a, b) => b.heldOn.localeCompare(a.heldOn));
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Scale className="size-5 text-primary" aria-hidden="true" />
            {t('exams.check.title')}
          </span>
        }
        description={t('exams.check.body')}
      />
      {ofClass.length === 0 ? (
        <CardBody>
          <p className="text-sm text-fg-muted">{t('exams.check.none')}</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-border">
          {ofClass.map((check) => (
            <PaperCheck key={check.paperId} check={check} classSectionId={classSectionId} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PaperCheck({ check, classSectionId }: { check: MarksCheck; classSectionId: string }) {
  const { t, i18n } = useTranslation();
  const exams = useQuery(clusterExamsQuery());
  const [open, setOpen] = useState(false);
  const exam = exams.data?.find((entry) => entry.id === check.examId);
  return (
    <li className="space-y-2 px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-fg">
          {t('exams.check.paper', {
            subject: subjectName({ subject: check.subject, subjectName: null }, t),
            exam: exam ? examName(exam, t) : '',
            date: formatDay(check.heldOn, i18n.language),
          })}
        </p>
        {check.flagged ? <Badge tone="warning">{t('exams.check.flag')}</Badge> : null}
      </div>
      <p className="text-sm text-fg-muted">
        {[
          t('exams.check.compared', { count: check.compared }),
          check.highMarks > 0
            ? t('exams.check.highButWeak', { weak: check.highButWeak, high: check.highMarks })
            : null,
          check.lowButStrong > 0
            ? t('exams.check.lowButStrong', { count: check.lowButStrong })
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t('exams.check.hideChildren') : t('exams.check.showChildren')}
      </Button>
      {open ? <PaperChildren paperId={check.paperId} classSectionId={classSectionId} /> : null}
    </li>
  );
}

function PaperChildren({ paperId, classSectionId }: { paperId: string; classSectionId: string }) {
  const { t, i18n } = useTranslation();
  const pairs = useQuery(marksPulseQuery(paperId));
  const roster = useQuery(classRosterQuery(classSectionId));
  const nameOf = (studentId: string) =>
    roster.data?.find((entry) => entry.studentId === studentId)?.fullName ??
    t('exams.check.unnamed');
  if (pairs.isPending) {
    return <p className="text-sm text-fg-muted">{t('exams.check.loading')}</p>;
  }
  if (pairs.isError) {
    return <p className="text-sm text-danger">{t('exams.check.failed')}</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {[...pairs.data]
        .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
        .map((pair) => (
          <li key={pair.studentId} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-fg">{nameOf(pair.studentId)}</span>
            <span className="text-fg tabular-nums">
              {pair.percent === null ? '–' : `${formatMarks(pair.percent, i18n.language)}%`}
            </span>
            <span className="text-fg">
              {ENGLISH_LEVELS.includes(pair.pulseLevel) ? (
                <EnglishLevelLabel level={pair.pulseLevel} />
              ) : (
                <ReadingLevelLabel level={pair.pulseLevel} />
              )}
            </span>
            <span className="text-fg-muted">({t(`exams.check.source.${pair.source}`)})</span>
          </li>
        ))}
    </ul>
  );
}
