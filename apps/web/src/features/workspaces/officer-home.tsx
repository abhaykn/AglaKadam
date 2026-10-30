import { useQuery } from '@tanstack/react-query';
import { Landmark, Network, School } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatTile } from '@/components/ui/stat-tile';
import { useCurrentAccess } from '@/features/app-shell/access-context';
import type { AccessScope } from '@/features/auth/access';
import { getSupabase } from '@/lib/supabase';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useLocalisedName } from '@/lib/use-localised-name';
import { AreaReportSection } from '@/features/progress/area-report';
import { PageHeader } from './page-header';
import { QueryState } from './query-state';

/** Number of clusters and schools inside a district or block, counted by the database. */
function useScopeFigures(scope: AccessScope) {
  return useQuery({
    queryKey: ['officer-scope', scope.type, scope.id],
    meta: { persist: true },
    queryFn: async () => {
      const supabase = getSupabase();
      const clusters =
        scope.type === 'block'
          ? supabase
              .from('clusters')
              .select('id', { count: 'exact', head: true })
              .eq('block_id', scope.id)
          : supabase
              .from('clusters')
              .select('id, blocks!inner(district_id)', { count: 'exact', head: true })
              .eq('blocks.district_id', scope.id);
      const schools =
        scope.type === 'block'
          ? supabase
              .from('schools')
              .select('id, clusters!inner(block_id)', { count: 'exact', head: true })
              .eq('clusters.block_id', scope.id)
              .eq('is_active', true)
          : supabase
              .from('schools')
              .select('id, clusters!inner(blocks!inner(district_id))', {
                count: 'exact',
                head: true,
              })
              .eq('clusters.blocks.district_id', scope.id)
              .eq('is_active', true);
      const [clusterResult, schoolResult] = await Promise.all([clusters, schools]);
      if (clusterResult.error) {
        throw clusterResult.error;
      }
      if (schoolResult.error) {
        throw schoolResult.error;
      }
      return { clusters: clusterResult.count ?? 0, schools: schoolResult.count ?? 0 };
    },
  });
}

function ScopeCard({ scope }: { scope: AccessScope }) {
  const { t, i18n } = useTranslation();
  const localise = useLocalisedName();
  const figures = useScopeFigures(scope);
  const number = new Intl.NumberFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN');

  return (
    <Card aria-labelledby={`scope-${scope.id}`}>
      <CardHeader
        titleId={`scope-${scope.id}`}
        title={
          <span className="inline-flex items-center gap-2">
            <Landmark className="size-5 text-primary" aria-hidden="true" />
            {localise(scope)}
          </span>
        }
        description={t(scope.type === 'block' ? 'home.blockScope' : 'home.districtScope')}
      />
      <QueryState
        isPending={figures.isPending}
        isError={figures.isError}
        onRetry={() => void figures.refetch()}
        rows={1}
      >
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            <StatTile
              icon={Network}
              label={t('home.columns.clusters')}
              value={number.format(figures.data?.clusters ?? 0)}
            />
            <StatTile
              icon={School}
              label={t('home.columns.schools')}
              value={number.format(figures.data?.schools ?? 0)}
            />
          </dl>
        </CardBody>
      </QueryState>
    </Card>
  );
}

export function OfficerHome() {
  const { t } = useTranslation();
  const access = useCurrentAccess();
  const scopes = access.assignments
    .filter(
      (assignment) => assignment.role === 'district_officer' || assignment.role === 'block_officer',
    )
    .flatMap((assignment) => (assignment.scope ? [assignment.scope] : []));
  useDocumentTitle(t('workspaces.officer'));

  return (
    <div className="container-page space-y-6 py-8">
      <PageHeader
        title={t('home.greeting', { name: access.full_name })}
        description={t('home.officerDescription')}
      />
      <div className="grid gap-6 md:grid-cols-2">
        {scopes.map((scope) => (
          <ScopeCard key={`${scope.type}-${scope.id}`} scope={scope} />
        ))}
      </div>
      <AreaReportSection />
    </div>
  );
}
