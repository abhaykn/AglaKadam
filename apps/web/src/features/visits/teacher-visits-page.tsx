import { useQuery } from '@tanstack/react-query';
import { HandHelping, Printer, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/alert';
import { BackLink } from '@/components/ui/back-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { classDetailsQuery } from '@/features/attendance/attendance-api';
import { dayInIndia, formatDay } from '@/features/attendance/dates';
import { useWaitingChange } from '@/features/offline/use-waiting-change';
import { classLabel } from '@/features/workspaces/grade-label';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { practice as practiceOf } from './practice-library';
import { requestDedupeKey, type VisitRequestChange } from './visit-change';
import {
  classTeachersQuery,
  classVisitsQuery,
  openRequestQuery,
  useSaveRequest,
} from './visit-api';
import { VisitRecord } from './visit-page';
import { PracticeCard } from './visit-ui';

const TOPICS = ['reading', 'english', 'classroom', 'other'] as const;

/** A teacher's view of the CRP's visits to a class: the practice card, the record, and a request. */
export function TeacherVisitsPage({ classSectionId }: { classSectionId: string }) {
  const { t, i18n } = useTranslation();
  const access = useCurrentAccess();
  const localise = useLocalisedName();
  const details = useQuery(classDetailsQuery(classSectionId));
  const visits = useQuery(classVisitsQuery(classSectionId));
  const teachers = useQuery(classTeachersQuery(classSectionId));
  const title = details.data
    ? classLabel(t, details.data.grade, details.data.section)
    : t('visits.teacher.title');
  useDocumentTitle(t('visits.teacher.title'));

  const history = visits.data ?? [];
  // The step agreed with this teacher, or at a visit where no one teacher was observed.
  const current = history.find(
    (visit) =>
      visit.feedback?.agreedAt && (visit.teacherId === access.user_id || visit.teacherId === null),
  );
  const currentPractice = current?.feedback?.practiceCode
    ? practiceOf(current.feedback.practiceCode)
    : undefined;

  return (
    <div className="container-page space-y-6 py-8">
      <BackLink to="/app/teacher">{t('app.home')}</BackLink>
      <PageHeader title={t('visits.teacher.title')} description={title} />

      <QueryState
        isPending={visits.isPending}
        isError={visits.isError}
        onRetry={() => void visits.refetch()}
      >
        {current && currentPractice && details.data ? (
          <section className="space-y-3" aria-labelledby="card-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="card-title" className="text-lg font-semibold text-fg">
                {t('visits.teacher.cardTitle')}
              </h2>
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer aria-hidden="true" />
                {t('visits.agree.print')}
              </Button>
            </div>
            <PracticeCard
              visit={current}
              practice={currentPractice}
              classLabel={title}
              schoolName={localise(details.data.school)}
              teacherName={current.teacherId === access.user_id ? access.full_name : null}
            />
          </section>
        ) : (
          <Card>
            <CardBody>
              <p className="text-sm text-fg-muted">{t('visits.teacher.noCard')}</p>
            </CardBody>
          </Card>
        )}
      </QueryState>

      {details.data ? (
        <RequestCard
          classSectionId={classSectionId}
          schoolId={details.data.school.id}
          label={{ grade: details.data.grade, section: details.data.section }}
          userId={access.user_id}
          classTeachers={teachers.data}
        />
      ) : null}

      <section className="space-y-3" aria-labelledby="history-title">
        <h2 id="history-title" className="text-lg font-semibold text-fg">
          {t('visits.teacher.historyTitle')}
        </h2>
        {history.length === 0 && !visits.isPending ? (
          <EmptyState
            icon={HandHelping}
            title={t('visits.teacher.noVisits.title')}
            description={t('visits.teacher.noVisits.body')}
          />
        ) : (
          history.map((visit) => (
            <div key={visit.id} className="space-y-2">
              <p className="text-sm font-medium text-fg">
                {visit.visitedOn ? formatDay(visit.visitedOn, i18n.language) : ''}
              </p>
              <VisitRecord visit={visit} />
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function RequestCard({
  classSectionId,
  schoolId,
  label,
  userId,
  classTeachers,
}: {
  classSectionId: string;
  schoolId: string;
  label: VisitRequestChange['classLabel'];
  userId: string;
  /** The class's teachers, when known on the phone. */
  classTeachers: string[] | undefined;
}) {
  const { t, i18n } = useTranslation();
  const request = useQuery(openRequestQuery(classSectionId));
  const waiting = useWaitingChange(requestDedupeKey(classSectionId));
  const saveRequest = useSaveRequest();
  const [topic, setTopic] = useState<(typeof TOPICS)[number] | null>(null);
  const [note, setNote] = useState('');
  const waitingPayload = waiting.payload as VisitRequestChange | null | undefined;
  const asked = waiting.state === 'pending' && waitingPayload && !waitingPayload.withdrawId;
  // The class's teachers ask for a visit, or any teacher of the school while it has none; the one
  // who asked or a class teacher may withdraw it. The server checks the same.
  const teachesClass = classTeachers?.includes(userId) ?? false;
  const mayAsk = classTeachers === undefined || classTeachers.length === 0 || teachesClass;
  const ownRequest = request.data?.requestedBy === userId;
  const mayWithdraw = ownRequest || teachesClass;

  return (
    <Card>
      <CardHeader title={t('visits.request.title')} description={t('visits.request.body')} />
      <CardBody className="space-y-4">
        {waiting.state === 'failed' ? (
          <Alert tone="danger">{t('visits.request.failed')}</Alert>
        ) : null}
        {request.data ? (
          <div className="space-y-3">
            <p className="text-sm text-fg">
              {t(ownRequest ? 'visits.request.open' : 'visits.request.openByColleague', {
                topic: t(`visits.topic.${request.data.topic}`),
                date: formatDay(dayInIndia(request.data.createdAt), i18n.language),
              })}
            </p>
            {mayWithdraw ? (
              <Button
                variant="secondary"
                onClick={() =>
                  void saveRequest({
                    classSectionId,
                    schoolId,
                    withdrawId: request.data?.id ?? null,
                    topic: request.data?.topic ?? 'reading',
                    note: '',
                    classLabel: label,
                  })
                }
              >
                <Undo2 aria-hidden="true" />
                {t('visits.request.withdraw')}
              </Button>
            ) : null}
          </div>
        ) : asked ? (
          <Badge tone="warning">{t('visits.request.waiting')}</Badge>
        ) : !mayAsk ? (
          <p className="text-sm text-fg-muted">{t('visits.request.classTeacherOnly')}</p>
        ) : (
          <>
            <ChoiceGroup
              label={t('visits.request.topic')}
              value={topic}
              onChange={setTopic}
              options={TOPICS.map((value) => ({ value, label: t(`visits.topic.${value}`) }))}
            />
            <Field label={t('visits.request.note')}>
              <Textarea
                value={note}
                maxLength={300}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
            <Button
              disabled={topic === null}
              onClick={() => {
                if (topic) {
                  void saveRequest({
                    classSectionId,
                    schoolId,
                    withdrawId: null,
                    topic,
                    note,
                    classLabel: label,
                  }).then((kept) => {
                    // What was typed stays when the request could be neither kept nor sent.
                    if (kept) {
                      setTopic(null);
                      setNote('');
                    }
                  });
                }
              }}
            >
              <HandHelping aria-hidden="true" />
              {t('visits.request.send')}
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}
