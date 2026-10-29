import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, ListTodo, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { todayInIndia } from '@shared/accounts.ts';
import { BackLink } from '@/components/ui/back-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import { formatDay } from '@/features/attendance/dates';
import { scopesFor } from '@/features/auth/access';
import { OrderReader } from '@/features/sahayak/order-reader';
import { PageHeader } from '@/features/workspaces/page-header';
import { QueryState } from '@/features/workspaces/query-state';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { planWeek } from './plan';
import type { CrpTask } from './visit-change';
import { crpTasksQuery, schoolsOverviewQuery, useSaveTask, type StoredTask } from './visit-api';
import { useSchoolName } from './visit-hooks';

const SOURCES = ['order', 'circular', 'meeting', 'own'] as const;

type Group = 'overdue' | 'week' | 'later' | 'undated' | 'done';

function groupOf(task: StoredTask, today: string, weekEnd: string): Group {
  if (task.done) {
    return 'done';
  }
  if (task.dueOn === null) {
    return 'undated';
  }
  if (task.dueOn < today) {
    return 'overdue';
  }
  return task.dueOn <= weekEnd ? 'week' : 'later';
}

export function TasksPage() {
  const { t, i18n } = useTranslation();
  const tasks = useQuery(crpTasksQuery());
  const saveTask = useSaveTask();
  const access = useCurrentAccess();
  const clusterId = scopesFor(access, 'crp')[0]?.id ?? null;
  const schoolName = useSchoolName();
  const [editing, setEditing] = useState<CrpTask | 'new' | null>(null);
  // Tasks are shared across the cluster, so removing one asks first.
  const [removing, setRemoving] = useState<StoredTask | null>(null);
  const today = todayInIndia();
  const weekEnd = planWeek(today).end;
  useDocumentTitle(t('visits.tasks.title'));

  const groups: Group[] = ['overdue', 'week', 'later', 'undated', 'done'];
  const sorted = [...(tasks.data ?? [])].sort(
    (a, b) =>
      (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || a.title.localeCompare(b.title),
  );

  return (
    <div className="container-page space-y-6 py-8">
      <BackLink to="/app/crp">{t('visits.plan.back')}</BackLink>
      <PageHeader
        title={t('visits.tasks.title')}
        description={t('visits.tasks.description')}
        actions={
          <>
            {clusterId ? (
              <OrderReader
                onAdd={(found) => {
                  // Tasks read from an order belong to the CRP's first cluster; each can be moved
                  // to a school or another cluster afterwards.
                  for (const task of found) {
                    void saveTask({
                      id: crypto.randomUUID(),
                      clusterId,
                      schoolId: null,
                      title: task.title.slice(0, 200),
                      details: (task.details ?? '').slice(0, 2000),
                      source: 'order',
                      dueOn: task.dueOn,
                      done: false,
                      doneAt: null,
                      removed: false,
                    });
                  }
                }}
              />
            ) : null}
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              {t('visits.tasks.add')}
            </Button>
          </>
        }
      />
      <QueryState
        isPending={tasks.isPending}
        isError={tasks.isError}
        onRetry={() => void tasks.refetch()}
      >
        {sorted.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={t('visits.tasks.empty.title')}
            description={t('visits.tasks.empty.body')}
          />
        ) : (
          groups.map((group) => {
            const ofGroup = sorted.filter((task) => groupOf(task, today, weekEnd) === group);
            if (ofGroup.length === 0) {
              return null;
            }
            return (
              <Card key={group} aria-labelledby={`tasks-${group}`}>
                <CardHeader titleId={`tasks-${group}`} title={t(`visits.tasks.group.${group}`)} />
                <ul className="divide-y divide-border">
                  {ofGroup.map((task) => (
                    <li key={task.id} className="flex items-start gap-3 px-5 py-3">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-pressed={task.done}
                        aria-label={
                          task.done
                            ? t('visits.tasks.markOpen', { title: task.title })
                            : t('visits.tasks.markDone', { title: task.title })
                        }
                        onClick={() =>
                          void saveTask({
                            ...task,
                            done: !task.done,
                            doneAt: task.done ? null : new Date().toISOString(),
                          })
                        }
                      >
                        {task.done ? (
                          <CheckCircle2 className="text-success" aria-hidden="true" />
                        ) : (
                          <Circle aria-hidden="true" />
                        )}
                      </Button>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p
                          className={
                            task.done ? 'text-fg-muted line-through' : 'font-medium text-fg'
                          }
                        >
                          {task.title}
                        </p>
                        <div className="flex flex-wrap gap-1.5 text-sm text-fg-muted">
                          <Badge>{t(`visits.tasks.source.${task.source}`)}</Badge>
                          {task.dueOn ? (
                            <Badge tone={group === 'overdue' ? 'danger' : 'neutral'}>
                              {t('visits.tasks.due', {
                                date: formatDay(task.dueOn, i18n.language),
                              })}
                            </Badge>
                          ) : null}
                          {task.schoolId ? <span>{schoolName(task.schoolId)}</span> : null}
                        </div>
                        {task.details ? (
                          <p className="text-sm text-fg-muted">{task.details}</p>
                        ) : null}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('visits.tasks.edit', { title: task.title })}
                        onClick={() => setEditing(task)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('visits.tasks.remove', { title: task.title })}
                        onClick={() => setRemoving(task)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })
        )}
      </QueryState>
      <Dialog open={removing !== null} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        {removing !== null ? (
          <DialogContent
            title={t('visits.tasks.removeTitle')}
            description={t('visits.tasks.removeBody', { title: removing.title })}
          >
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                {t('visits.tasks.keep')}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  void saveTask({ ...removing, removed: true });
                  setRemoving(null);
                }}
              >
                <Trash2 aria-hidden="true" />
                {t('visits.tasks.removeConfirm')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
      <Dialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        {editing !== null ? (
          <DialogContent
            title={editing === 'new' ? t('visits.tasks.add') : t('visits.tasks.editTitle')}
          >
            <TaskForm
              task={editing === 'new' ? null : editing}
              onSaved={(task) => {
                // The form stays open with what was typed when the task could not be kept.
                void saveTask(task).then((kept) => {
                  if (kept) {
                    setEditing(null);
                  }
                });
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function TaskForm({ task, onSaved }: { task: CrpTask | null; onSaved: (task: CrpTask) => void }) {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const localise = useLocalisedName();
  const clusters = scopesFor(access, 'crp');
  const schools = useQuery(schoolsOverviewQuery());
  const [title, setTitle] = useState(task?.title ?? '');
  const [details, setDetails] = useState(task?.details ?? '');
  const [source, setSource] = useState<CrpTask['source']>(task?.source ?? 'order');
  const [dueOn, setDueOn] = useState(task?.dueOn ?? '');
  const [clusterId, setClusterId] = useState(task?.clusterId ?? clusters[0]?.id ?? '');
  const [schoolId, setSchoolId] = useState(task?.schoolId ?? '');
  const [error, setError] = useState<string | null>(null);
  const clusterSchools = (schools.data ?? []).filter((school) => school.cluster_id === clusterId);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      setError(t('visits.tasks.titleRequired'));
      return;
    }
    onSaved({
      id: task?.id ?? crypto.randomUUID(),
      clusterId,
      schoolId: schoolId || null,
      title: title.trim().slice(0, 200),
      details: details.slice(0, 2000),
      source,
      dueOn: dueOn || null,
      done: task?.done ?? false,
      doneAt: task?.doneAt ?? null,
      removed: false,
    });
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <Field label={t('visits.tasks.titleLabel')} error={error}>
        <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('visits.tasks.sourceLabel')}>
          <Select
            value={source}
            onChange={(event) =>
              setSource(SOURCES.find((entry) => entry === event.target.value) ?? 'order')
            }
          >
            {SOURCES.map((entry) => (
              <option key={entry} value={entry}>
                {t(`visits.tasks.source.${entry}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('visits.tasks.dueLabel')}>
          <Input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
        </Field>
      </div>
      {clusters.length > 1 ? (
        <Field label={t('visits.tasks.clusterLabel')}>
          <Select
            value={clusterId}
            onChange={(event) => {
              setClusterId(event.target.value);
              setSchoolId('');
            }}
          >
            {clusters.map((cluster) => (
              <option key={cluster.id} value={cluster.id}>
                {localise(cluster)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label={t('visits.tasks.schoolLabel')}>
        <Select value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
          <option value="">{t('visits.tasks.noSchool')}</option>
          {clusterSchools.map((school) => (
            <option key={school.school_id} value={school.school_id}>
              {localise(school)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('visits.tasks.detailsLabel')}>
        <Textarea
          value={details}
          maxLength={2000}
          onChange={(event) => setDetails(event.target.value)}
        />
      </Field>
      <Button type="submit">{t('visits.tasks.save')}</Button>
    </form>
  );
}
