import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CalendarPlus, ClipboardList, MessageCircleWarning, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackLink } from '@/components/ui/back-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { formatDay } from '@/features/attendance/dates';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import { scopesFor } from '@/features/auth/access';
import { crpSignalQuery, schoolsOverviewQuery } from '@/features/visits/visit-api';
import { useSchoolName } from '@/features/visits/visit-hooks';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { examDedupeKey, examName, subjectName } from './exam-change';
import { clusterExamsQuery, marksChecksQuery, useRemoveExam, type ClusterExam } from './exam-api';
import { examReasonFor } from './exam-reasons';
import { ScheduleExamDialog } from './schedule-exam-dialog';

/** The CRP's view of exams: those of the cluster and its schools, and the marks to talk over. */
export function CrpExamsPage() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const localise = useLocalisedName();
  const clusters = scopesFor(access, 'crp');
  const exams = useQuery(clusterExamsQuery());
  const signals = useQuery(crpSignalQuery());
  const schools = useQuery(schoolsOverviewQuery());
  const checks = useQuery(marksChecksQuery());
  const schoolName = useSchoolName();
  const [scheduling, setScheduling] = useState<string | null>(null);
  useDocumentTitle(t('exams.crp.title'));

  const clusterOf = (schoolId: string) =>
    schools.data?.find((school) => school.school_id === schoolId)?.cluster_id ?? null;
  const classesOf = (clusterId: string) =>
    (signals.data ?? [])
      .filter((signal) => clusterOf(signal.schoolId) === clusterId)
      .map((signal) => ({
        id: signal.classSectionId,
        grade: signal.grade,
        schoolId: signal.schoolId,
      }));
  const signalOf = (classSectionId: string) =>
    signals.data?.find((signal) => signal.classSectionId === classSectionId);
  const flagged = (checks.data ?? []).filter((check) => check.flagged);

  return (
    <div className="container-page space-y-6 py-8">
      <BackLink to="/app/crp">{t('exams.crp.back')}</BackLink>
      <PageHeader
        title={t('exams.crp.title')}
        description={t('exams.crp.description')}
        actions={clusters.map((cluster) => (
          <Dialog
            key={cluster.id}
            open={scheduling === cluster.id}
            onOpenChange={(open) => setScheduling(open ? cluster.id : null)}
          >
            <DialogTrigger asChild>
              <Button disabled={classesOf(cluster.id).length === 0}>
                <CalendarPlus aria-hidden="true" />
                {clusters.length > 1
                  ? `${t('exams.crp.schedule')} · ${localise(cluster)}`
                  : t('exams.crp.schedule')}
              </Button>
            </DialogTrigger>
            {scheduling === cluster.id ? (
              <ScheduleExamDialog
                target={{ kind: 'cluster', clusterId: cluster.id, classes: classesOf(cluster.id) }}
                onDone={() => setScheduling(null)}
              />
            ) : null}
          </Dialog>
        ))}
      />

      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <MessageCircleWarning className="size-5 text-primary" aria-hidden="true" />
              {t('exams.crp.checksTitle')}
            </span>
          }
          description={t('exams.crp.checksBody')}
        />
        <QueryState
          isPending={checks.isPending}
          isError={checks.isError}
          onRetry={() => void checks.refetch()}
        >
          {flagged.length === 0 ? (
            <CardBody>
              <p className="text-sm text-fg-muted">{t('exams.crp.noChecks')}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-border">
              {flagged.map((check) => {
                const signal = signalOf(check.classSectionId);
                return (
                  <li
                    key={check.paperId}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-fg">
                        {[
                          subjectName({ subject: check.subject, subjectName: null }, t),
                          signal ? classLabel(t, signal.grade, signal.section) : null,
                          schoolName(check.schoolId),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <p className="text-sm text-fg-muted">
                        {t('exams.crp.checkLine', {
                          weak: check.highButWeak,
                          high: check.highMarks,
                        })}
                      </p>
                    </div>
                    <Button asChild variant="secondary">
                      <Link to="/app/crp/class/$classId" params={{ classId: check.classSectionId }}>
                        {t('exams.crp.openClass')}
                      </Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </Card>

      <QueryState
        isPending={exams.isPending}
        isError={exams.isError}
        onRetry={() => void exams.refetch()}
      >
        {(exams.data ?? []).length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t('exams.crp.empty.title')}
            description={t('exams.crp.empty.body')}
          />
        ) : (
          <div className="space-y-4">
            {(exams.data ?? []).map((exam) => (
              <ExamProgress key={exam.id} exam={exam} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function ExamProgress({ exam }: { exam: ClusterExam }) {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const schoolName = useSchoolName();
  const waiting = useWaitingChange(examDedupeKey(exam.id));
  const removeExam = useRemoveExam();
  const [removing, setRemoving] = useState(false);
  // The CRPs of the cluster manage its exams, and those of its schools.
  const removable =
    (exam.createdBy === access.user_id || exam.clusterId !== null || exam.schoolId !== null) &&
    exam.papers.every((paper) => paper.results === 0);
  const bySchool = new Map<string, { papers: number; marked: number }>();
  for (const paper of exam.papers) {
    const entry = bySchool.get(paper.schoolId) ?? { papers: 0, marked: 0 };
    entry.papers += 1;
    entry.marked += paper.results > 0 ? 1 : 0;
    bySchool.set(paper.schoolId, entry);
  }
  const marked = exam.papers.filter((paper) => paper.results > 0).length;
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {examName(exam, t)}
            {exam.clusterId ? (
              <Badge tone="brand">{t('exams.crp.forCluster')}</Badge>
            ) : (
              <Badge>{t('exams.crp.bySchool')}</Badge>
            )}
          </span>
        }
        description={[
          exam.startsOn === exam.endsOn
            ? formatDay(exam.startsOn, i18n.language)
            : t('exams.crp.dates', {
                from: formatDay(exam.startsOn, i18n.language),
                to: formatDay(exam.endsOn, i18n.language),
              }),
          t('exams.crp.progress', { marked, count: exam.papers.length }),
        ].join(' · ')}
        actions={
          removable ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('exams.class.remove')}
              onClick={() => setRemoving(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null
        }
      />
      {waiting.state === 'pending' ? (
        <p className="px-5 pt-3 text-sm text-fg-muted">{t('exams.class.waiting')}</p>
      ) : null}
      {waiting.state === 'failed' && waiting.error ? (
        <p className="px-5 pt-3 text-sm font-medium text-danger">
          {examReasonFor(waiting.error, t)}
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {[...bySchool.entries()].map(([schoolId, counts]) => (
          <li
            key={schoolId}
            className="flex flex-wrap items-center justify-between gap-2 px-5 py-2"
          >
            <span className="text-sm text-fg">{schoolName(schoolId)}</span>
            <Badge tone={counts.marked === counts.papers ? 'success' : 'neutral'}>
              {t('exams.crp.progress', { marked: counts.marked, count: counts.papers })}
            </Badge>
          </li>
        ))}
      </ul>
      <Dialog open={removing} onOpenChange={setRemoving}>
        {removing ? (
          <DialogContent
            title={t('exams.removeDialog.title')}
            description={t('exams.removeDialog.body', { exam: examName(exam, t) })}
          >
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoving(false)}>
                {t('exams.removeDialog.keep')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  void removeExam({
                    examId: exam.id,
                    kind: exam.kind,
                    title: exam.title,
                    classSectionIds: [...new Set(exam.papers.map((paper) => paper.classSectionId))],
                  });
                  setRemoving(false);
                }}
              >
                <Trash2 aria-hidden="true" />
                {t('exams.removeDialog.confirm')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}
