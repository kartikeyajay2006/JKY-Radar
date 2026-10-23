/** @import { AnalysisDTO, AnalysisSummaryDTO, AuditEventDTO, ConsumerDTO, FindingDTO, ImpactDTO, InvitationDTO, MemberDTO, NotificationDTO, OverviewDTO, PageMeta, PolicyDTO, ProjectDTO, ReviewDTO, Role, UpdatePolicyInput, UserDTO, VersionDTO, WorkspaceDTO } from '@jky/shared' */
/** @import { AnalysisOptions, FindingSeverity, Protocol, RuleDefinition } from '@jky/radar-core' */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';

/**
 *  Analyses are read either from a private workspace or from the public demo.
 * @typedef {'private' | 'demo'} AnalysisScope
 */
/**
 * @param {AnalysisScope} scope
 * @param {string} id
 */
export const analysisBase = (scope, id) => (scope === 'demo' ? `/demo/analyses/${id}` : `/analyses/${id}`);

/* ----------------------------------------------------------- meta */
/**
 * @typedef {Object} CapabilitiesDTO
 * @property {string} engineVersion
 * @property {string} ruleRegistryVersion
 * @property {string} adapterVersion
 * @property {Array<{ id: string; protocol: Protocol | null; label: string; formats: string[]; versions: string; status: 'supported' | 'partial' | 'experimental' | 'unsupported'; levels: { parse: string; semanticDiff: string; classification: string }; release: string; notes: string[]; rules: { registered: number; tested: number }; }>} adapters
 * @property {Record<string, number>} limits
 * @property {boolean} remoteUrlImport
 * @property {Record<Role, string>} roles
 * @property {string[]} limitations
 */
export const useCapabilities = () =>
  useQuery({
    queryKey: ['capabilities'],
    queryFn: async () =>
      (await /** @type {Promise<import('@/lib/api').Envelope<CapabilitiesDTO>>} */ (api.get('/capabilities')))
        .data,
    staleTime: 10 * 60_000,
  });
export const useRules = () =>
  useQuery({
    queryKey: ['rules'],
    queryFn: async () =>
      (await /** @type {Promise<import('@/lib/api').Envelope<RuleDefinition[]>>} */ (api.get('/rules'))).data,
    staleTime: 10 * 60_000,
  });

/* ----------------------------------------------------------- workspaces */
export const useWorkspaces = (enabled = true) =>
  useQuery({
    queryKey: ['workspaces'],
    queryFn: async () =>
      (await /** @type {Promise<import('@/lib/api').Envelope<WorkspaceDTO[]>>} */ (api.get('/workspaces')))
        .data,
    enabled,
  });
/** @param {string} [wid] */
export const useWorkspace = (wid) =>
  useQuery({
    queryKey: ['workspace', wid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<WorkspaceDTO>>} */ (
          api.get(`/workspaces/${wid}`)
        )
      ).data,
    enabled: !!wid,
  });
/** @param {string} [wid] */
export const useOverview = (wid) =>
  useQuery({
    queryKey: ['overview', wid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<OverviewDTO>>} */ (
          api.get(`/workspaces/${wid}/overview`)
        )
      ).data,
    enabled: !!wid,
  });
/** @param {string} [wid] */
export const useMembers = (wid) =>
  useQuery({
    queryKey: ['members', wid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<MemberDTO[]>>} */ (
          api.get(`/workspaces/${wid}/members`)
        )
      ).data,
    enabled: !!wid,
  });
export const useInvitations = () =>
  useQuery({
    queryKey: ['invitations'],
    queryFn: async () =>
      (await /** @type {Promise<import('@/lib/api').Envelope<InvitationDTO[]>>} */ (api.get('/invitations')))
        .data,
  });
/**
 * @param {string | undefined} wid
 * @param {number} page
 */
export const useAudit = (wid, page) =>
  useQuery({
    queryKey: ['audit', wid, page],
    queryFn: async () =>
      /** @type {Promise<import('@/lib/api').Envelope<AuditEventDTO[], PageMeta>>} */ (
        api.get(`/workspaces/${wid}/audit?page=${page}&pageSize=30`)
      ),
    enabled: !!wid,
    placeholderData: keepPreviousData,
  });
/**
 * @param {string | undefined} wid
 * @param {number} page
 */
export const useWorkspaceAnalyses = (wid, page) =>
  useQuery({
    queryKey: ['ws-analyses', wid, page],
    queryFn: async () =>
      /** @type {Promise<import('@/lib/api').Envelope<AnalysisSummaryDTO[], PageMeta>>} */ (
        api.get(`/workspaces/${wid}/analyses?page=${page}&pageSize=20`)
      ),
    enabled: !!wid,
    placeholderData: keepPreviousData,
  });

/* ----------------------------------------------------------- projects */
/**
 * @param {string} [wid]
 * @param {string} [search]
 */
export const useProjects = (wid, search) =>
  useQuery({
    queryKey: ['projects', wid, search ?? ''],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<ProjectDTO[]>>} */ (
          api.get(`/workspaces/${wid}/projects${search ? `?search=${encodeURIComponent(search)}` : ''}`)
        )
      ).data,
    enabled: !!wid,
    placeholderData: keepPreviousData,
  });
/** @param {string} [pid] */
export const useProject = (pid) =>
  useQuery({
    queryKey: ['project', pid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<ProjectDTO & { role: Role }>>} */ (
          api.get(`/projects/${pid}`)
        )
      ).data,
    enabled: !!pid,
  });
/** @param {string} [pid] */
export const useVersions = (pid) =>
  useQuery({
    queryKey: ['versions', pid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<VersionDTO[]>>} */ (
          api.get(`/projects/${pid}/versions`)
        )
      ).data,
    enabled: !!pid,
  });
/** @param {string} [vid] */
export const useVersionContent = (vid) =>
  useQuery({
    queryKey: ['version-content', vid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<{ content: string; fileName: string | null }>>} */ (
          api.get(`/versions/${vid}/content`)
        )
      ).data,
    enabled: !!vid,
    staleTime: Infinity,
  });
/** @param {string} [pid] */
export const useProjectAnalyses = (pid) =>
  useQuery({
    queryKey: ['project-analyses', pid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<AnalysisSummaryDTO[], PageMeta>>} */ (
          api.get(`/projects/${pid}/analyses?pageSize=50`)
        )
      ).data,
    enabled: !!pid,
  });
/** @param {string} [pid] */
export const useConsumers = (pid) =>
  useQuery({
    queryKey: ['consumers', pid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<ConsumerDTO[]>>} */ (
          api.get(`/projects/${pid}/consumers`)
        )
      ).data,
    enabled: !!pid,
  });
/** @param {string} [pid] */
export const useEntities = (pid) =>
  useQuery({
    queryKey: ['entities', pid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<Array<{ key: string; label: string; kind: string }>>>} */ (
          api.get(`/projects/${pid}/entities`)
        )
      ).data,
    enabled: !!pid,
  });
/** @param {string} [pid] */
export const usePolicy = (pid) =>
  useQuery({
    queryKey: ['policy', pid],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<{ current: PolicyDTO; history: PolicyDTO[] }>>} */ (
          api.get(`/projects/${pid}/policy`)
        )
      ).data,
    enabled: !!pid,
  });

/* ----------------------------------------------------------- analyses */
/**
 * @param {AnalysisScope} scope
 * @param {string} [id]
 */
export const useAnalysis = (scope, id) =>
  useQuery({
    queryKey: ['analysis', scope, id],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<AnalysisDTO>>} */ (
          api.get(analysisBase(scope, id))
        )
      ).data,
    enabled: !!id,
    refetchInterval: (q) =>
      q.state.data && (q.state.data.state === 'queued' || q.state.data.state === 'running') ? 600 : false,
  });

/**
 * @typedef {Object} FindingFilters
 * @property {FindingSeverity[]} severity
 * @property {string} [ruleId]
 * @property {string} [search]
 * @property {string} [entity]
 * @property {number} page
 * @property {number} pageSize
 */
/**
 * @typedef {PageMeta & { facets: { severity: Partial<Record<FindingSeverity, number>>; rules: Array<{ ruleId: string; count: number }>; } }} FindingsMeta
 */
/**
 * @param {AnalysisScope} scope
 * @param {string | undefined} id
 * @param {FindingFilters} f
 */
export const useFindings = (scope, id, f, enabled = true) =>
  useQuery({
    queryKey: ['findings', scope, id, f],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(f.page), pageSize: String(f.pageSize) });
      for (const s of f.severity) qs.append('severity', s);
      if (f.ruleId) qs.set('ruleId', f.ruleId);
      if (f.search) qs.set('search', f.search);
      if (f.entity) qs.set('entity', f.entity);
      return /** @type {Promise<import('@/lib/api').Envelope<FindingDTO[], FindingsMeta>>} */ (
        api.get(`${analysisBase(scope, id)}/findings?${qs.toString()}`)
      );
    },
    enabled: !!id && enabled,
    placeholderData: keepPreviousData,
  });
/**
 * @param {AnalysisScope} scope
 * @param {string} [id]
 */
export const useImpact = (scope, id, enabled = true) =>
  useQuery({
    queryKey: ['impact', scope, id],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<ImpactDTO>>} */ (
          api.get(`${analysisBase(scope, id)}/impact`)
        )
      ).data,
    enabled: !!id && enabled,
  });
/**
 * @param {AnalysisScope} scope
 * @param {string} [id]
 */
export const useSources = (scope, id, enabled = true) =>
  useQuery({
    queryKey: ['sources', scope, id],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<{ baseline: { label: string; fileName: string | null; content: string; versionId: string }; candidate: { label: string; fileName: string | null; content: string; versionId: string }; }>>} */ (
          api.get(`${analysisBase(scope, id)}/sources`)
        )
      ).data,
    enabled: !!id && enabled,
    staleTime: Infinity,
  });
/**
 * @param {AnalysisScope} scope
 * @param {string} [id]
 */
export const useReviews = (scope, id) =>
  useQuery({
    queryKey: ['reviews', scope, id],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<ReviewDTO[]>>} */ (
          api.get(`${analysisBase(scope, id)}/reviews`)
        )
      ).data,
    enabled: !!id,
  });
export const useDemoAnalyses = () =>
  useQuery({
    queryKey: ['demo-analyses'],
    queryFn: async () =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<Array<AnalysisSummaryDTO & { description: string }>>>} */ (
          api.get('/demo/analyses')
        )
      ).data,
    staleTime: 60_000,
  });

/* ----------------------------------------------------------- notifications */
export const useNotifications = (enabled = true) =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: async () =>
      /** @type {Promise<import('@/lib/api').Envelope<NotificationDTO[], { unread: number }>>} */ (
        api.get('/notifications')
      ),
    enabled,
    refetchInterval: 30_000,
  });

/* ----------------------------------------------------------- mutations */
export function useInvalidate() {
  const qc = useQueryClient();
  return /** @param {...unknown[]} keys */ (...keys) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

/** @param {string} [wid] */
export const useCreateProject = (wid) => {
  const inv = useInvalidate();
  return useMutation({
    /** @param {{ name: string; description: string; protocol: Protocol }} b */
    mutationFn: async (b) =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<ProjectDTO>>} */ (
          api.post(`/workspaces/${wid}/projects`, b)
        )
      ).data,
    onSuccess: () => inv(['projects', wid], ['overview', wid], ['workspaces']),
  });
};

/** @param {string} [pid] */
export const useUploadVersion = (pid) => {
  const inv = useInvalidate();
  return useMutation({
    /** @param {{ label: string; content?: string; file?: File; fileName?: string; protocol?: Protocol; notes?: string; }} b */
    mutationFn: async (b) => {
      if (b.file) {
        const fd = new FormData();
        fd.append('label', b.label);
        if (b.protocol) fd.append('protocol', b.protocol);
        if (b.notes) fd.append('notes', b.notes);
        fd.append('file', b.file, b.file.name);
        return (
          await /** @type {Promise<import('@/lib/api').Envelope<VersionDTO>>} */ (
            api.post(`/projects/${pid}/versions`, fd)
          )
        ).data;
      }
      return (
        await /** @type {Promise<import('@/lib/api').Envelope<VersionDTO>>} */ (
          api.post(`/projects/${pid}/versions`, {
            label: b.label,
            content: b.content,
            fileName: b.fileName,
            protocol: b.protocol,
            notes: b.notes,
          })
        )
      ).data;
    },
    onSuccess: () => inv(['versions', pid], ['project', pid], ['entities', pid]),
  });
};

/** @param {string} [pid] */
export const useCreateAnalysis = (pid) => {
  const inv = useInvalidate();
  return useMutation({
    /** @param {{ baselineId: string; candidateId: string; options: AnalysisOptions }} b */
    mutationFn: async (b) =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<AnalysisDTO>>} */ (
          api.post(`/projects/${pid}/analyses`, b)
        )
      ).data,
    onSuccess: () => inv(['project-analyses', pid], ['project', pid]),
  });
};

/** @param {string} [pid] */
export const useUpdatePolicy = (pid) => {
  const inv = useInvalidate();
  return useMutation({
    /** @param {UpdatePolicyInput} b */
    mutationFn: async (b) =>
      (
        await /** @type {Promise<import('@/lib/api').Envelope<PolicyDTO>>} */ (
          api.put(`/projects/${pid}/policy`, b)
        )
      ).data,
    onSuccess: () => inv(['policy', pid]),
  });
};
