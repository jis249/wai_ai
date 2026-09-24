import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LoginPage from './pages/auth/LoginPage'
import CallbackPage from './pages/auth/CallbackPage'
import { ToastProvider } from './hooks/useToast'
import { ThemeProvider } from './hooks/useTheme'
import { Shell } from './components/layout/Shell'
import { NotFoundPage } from './components/NotFoundPage'
import { LOCAL_STORAGE_KEY } from './lib/constants'
import { useMe } from './hooks/useMe'
import { lazyPage } from './lib/lazyPage'
import { TooltipProvider } from './components/ui/Tooltip'
import { RouteBoundary } from './components/RouteBoundary'

// Route-level code splitting: every page except the auth entry points loads on demand.
const AcceptInvitePage = lazyPage(() => import('./pages/AcceptInvitePage'))
const DashboardPage = lazyPage(() => import('./pages/DashboardPage'))
const KeysPage = lazyPage(() => import('./pages/KeysPage'))
const TeamsPage = lazyPage(() => import('./pages/TeamsPage'))
const TeamDetailPage = lazyPage(() => import('./pages/TeamDetailPage'))
const TeamMembersTab = lazyPage(() => import('./pages/TeamMembersTab'))
const TeamModelsTab = lazyPage(() => import('./pages/TeamModelsTab'))
const TeamSettingsTab = lazyPage(() => import('./pages/TeamSettingsTab'))
const TeamMCPAccessTab = lazyPage(() => import('./pages/TeamMCPAccessTab'))
const OrganizationPage = lazyPage(() => import('./pages/OrganizationPage'))
const OrgUsersPage = lazyPage(() => import('./pages/OrgUsersPage'))
const OrganizationsPage = lazyPage(() => import('./pages/OrganizationsPage'))
const OrgDetailPage = lazyPage(() => import('./pages/OrgDetailPage'))
const OrgDetailMembersTab = lazyPage(() => import('./pages/OrgDetailMembersTab'))
const OrgDetailTeamsTab = lazyPage(() => import('./pages/OrgDetailTeamsTab'))
const OrgDetailSettingsTab = lazyPage(() => import('./pages/OrgDetailSettingsTab'))
const OrgDetailSSOTab = lazyPage(() => import('./pages/OrgDetailSSOTab'))
const SSOConfigPage = lazyPage(() => import('./pages/SSOConfigPage'))
const ServiceAccountsPage = lazyPage(() => import('./pages/ServiceAccountsPage'))
const ModelsLayout = lazyPage(() => import('./pages/ModelsLayout'))
const ModelsCatalogPage = lazyPage(() => import('./pages/ModelsCatalogPage'))
const ModelsAccessTab = lazyPage(() => import('./pages/ModelsAccessTab'))
const MCPAccessTab = lazyPage(() => import('./pages/MCPAccessTab'))
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'))
const UsageLayout = lazyPage(() => import('./pages/usage/UsageLayout'))
const UsageOverviewPage = lazyPage(() => import('./pages/usage/UsageOverviewPage'))
const LLMUsagePage = lazyPage(() => import('./pages/usage/LLMUsagePage'))
const MCPUsagePage = lazyPage(() => import('./pages/usage/MCPUsagePage'))
const AutoUsagePage = lazyPage(() => import('./pages/usage/AutoUsagePage'))
const CostReportsPage = lazyPage(() => import('./pages/CostReportsPage'))
const RequestLogsPage = lazyPage(() => import('./pages/usage/RequestLogsPage'))
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'))
const AuditLogPage = lazyPage(() => import('./pages/AuditLogPage'))
const PlaygroundPage = lazyPage(() => import('./pages/PlaygroundPage'))
const SystemUsersPage = lazyPage(() => import('./pages/SystemUsersPage'))
const MCPServersPage = lazyPage(() => import('./pages/MCPServersPage'))
const MCPLayout = lazyPage(() => import('./pages/MCPLayout'))
const TeamAccessPanel = lazyPage(() => import('./pages/TeamAccessPanel'))
const SystemUsagePage = lazyPage(() => import('./pages/SystemUsagePage'))
const AutoRoutingPage = lazyPage(() => import('./pages/AutoRoutingPage'))
const SetupPage = lazyPage(() => import('./pages/SetupPage'))
const ApiAccessLayout = lazyPage(() => import('./pages/ApiAccessLayout'))
const PlatformLayout = lazyPage(() => import('./pages/PlatformLayout'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

function RequireAuth() {
  const token = localStorage.getItem(LOCAL_STORAGE_KEY)
  if (!token) return <Navigate to="/login" replace />
  return <Shell />
}

function HomeRoute() {
  const { data, isLoading } = useMe()
  if (isLoading) return null
  if (data?.role === 'member') return <Navigate to="/playground" replace />
  return <DashboardPage />
}

function OrgIndexRedirect() {
  const { data, isLoading } = useMe()
  const { search } = useLocation()
  if (isLoading) return null
  const isOrgAdmin = data?.role === 'org_admin' || data?.role === 'system_admin'
  // Keep the query (e.g. /org?invite=1 deep link) across the redirect.
  return <Navigate to={{ pathname: isOrgAdmin ? 'users' : 'settings', search }} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <TooltipProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/auth/callback" element={<CallbackPage />} />
                <Route element={<RouteBoundary />}>
                  <Route path="/invite/:token" element={<AcceptInvitePage />} />
                  <Route path="/setup" element={<SetupPage />} />
                </Route>
                <Route element={<RequireAuth />}>
                  <Route element={<RouteBoundary />}>
                    <Route index element={<HomeRoute />} />
                    <Route path="playground" element={<PlaygroundPage />} />
                    <Route element={<ApiAccessLayout />}>
                      <Route path="keys" element={<KeysPage hideHeader />} />
                      <Route path="service-accounts" element={<ServiceAccountsPage hideHeader />} />
                    </Route>
                    <Route path="teams" element={<TeamsPage />} />
                    <Route path="teams/:teamId" element={<TeamDetailPage />}>
                      <Route index element={<Navigate to="members" replace />} />
                      <Route path="members" element={<TeamMembersTab />} />
                      <Route path="models" element={<TeamModelsTab />} />
                      <Route path="mcp-access" element={<TeamMCPAccessTab />} />
                      <Route path="settings" element={<TeamSettingsTab />} />
                    </Route>
                    <Route path="org" element={<OrganizationPage />}>
                      <Route index element={<OrgIndexRedirect />} />
                      <Route path="settings" element={<SettingsPage />} />
                      <Route path="users" element={<OrgUsersPage />} />
                      <Route path="sso" element={<OrgDetailSSOTab />} />
                      <Route path="audit" element={<AuditLogPage hideHeader />} />
                      <Route path="models" element={<Navigate to="/models/org-access" replace />} />
                      <Route path="mcp-access" element={<Navigate to="/mcp/org-access" replace />} />
                    </Route>
                    <Route path="models" element={<ModelsLayout />}>
                      <Route index element={<ModelsCatalogPage />} />
                      <Route path="org-access" element={<ModelsAccessTab />} />
                      <Route path="team-access" element={<TeamAccessPanel kind="models" />} />
                    </Route>
                    <Route path="mcp" element={<MCPLayout />}>
                      <Route index element={<MCPServersPage hideHeader />} />
                      <Route path="org-access" element={<MCPAccessTab />} />
                      <Route path="team-access" element={<TeamAccessPanel kind="mcp" />} />
                    </Route>
                    <Route path="mcp-servers" element={<Navigate to="/mcp" replace />} />
                    <Route path="usage" element={<UsageLayout />}>
                      <Route index element={<UsageOverviewPage />} />
                      <Route path="llm" element={<LLMUsagePage />} />
                      <Route path="mcp" element={<MCPUsagePage />} />
                      <Route path="auto" element={<AutoUsagePage />} />
                      <Route path="cost" element={<CostReportsPage hideHeader />} />
                      <Route path="logs" element={<RequestLogsPage />} />
                    </Route>
                    <Route path="cost-reports" element={<Navigate to="/usage/cost" replace />} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="audit-log" element={<Navigate to="/org/audit" replace />} />
                    <Route path="sso" element={<SSOConfigPage />} />
                    <Route path="orgs" element={<OrganizationsPage />} />
                    <Route path="system-usage" element={<Navigate to="/platform/host" replace />} />
                    <Route path="auto-routing" element={<Navigate to="/platform/auto-routing" replace />} />
                    <Route path="platform" element={<PlatformLayout />}>
                      <Route index element={<Navigate to="setup" replace />} />
                      <Route path="setup" element={<SetupPage embedded />} />
                      <Route path="host" element={<SystemUsagePage hideHeader />} />
                      <Route path="auto-routing" element={<AutoRoutingPage hideHeader />} />
                    </Route>
                    <Route path="orgs/:orgId" element={<OrgDetailPage />}>
                      <Route index element={<Navigate to="members" replace />} />
                      <Route path="members" element={<OrgDetailMembersTab />} />
                      <Route path="teams" element={<OrgDetailTeamsTab />} />
                      <Route path="settings" element={<OrgDetailSettingsTab />} />
                      <Route path="sso" element={<OrgDetailSSOTab />} />
                    </Route>
                    <Route path="users" element={<SystemUsersPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Route>
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
