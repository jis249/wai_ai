import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LoginPage from './pages/auth/LoginPage'
import CallbackPage from './pages/auth/CallbackPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import DashboardPage from './pages/DashboardPage'
import KeysPage from './pages/KeysPage'
import TeamsPage from './pages/TeamsPage'
import TeamDetailPage from './pages/TeamDetailPage'
import TeamMembersTab from './pages/TeamMembersTab'
import TeamModelsTab from './pages/TeamModelsTab'
import TeamSettingsTab from './pages/TeamSettingsTab'
import TeamMCPAccessTab from './pages/TeamMCPAccessTab'
import OrganizationPage from './pages/OrganizationPage'
import OrgUsersPage from './pages/OrgUsersPage'
import OrganizationsPage from './pages/OrganizationsPage'
import OrgDetailPage from './pages/OrgDetailPage'
import OrgDetailMembersTab from './pages/OrgDetailMembersTab'
import OrgDetailTeamsTab from './pages/OrgDetailTeamsTab'
import OrgDetailSettingsTab from './pages/OrgDetailSettingsTab'
import OrgDetailSSOTab from './pages/OrgDetailSSOTab'
import SSOConfigPage from './pages/SSOConfigPage'
import ServiceAccountsPage from './pages/ServiceAccountsPage'
import ModelsLayout from './pages/ModelsLayout'
import ModelsCatalogPage from './pages/ModelsCatalogPage'
import ModelsAccessTab from './pages/ModelsAccessTab'
import MCPAccessTab from './pages/MCPAccessTab'
import SettingsPage from './pages/SettingsPage'
import UsageLayout from './pages/usage/UsageLayout'
import UsageOverviewPage from './pages/usage/UsageOverviewPage'
import LLMUsagePage from './pages/usage/LLMUsagePage'
import MCPUsagePage from './pages/usage/MCPUsagePage'
import AutoUsagePage from './pages/usage/AutoUsagePage'
import CostReportsPage from './pages/CostReportsPage'
import RequestLogsPage from './pages/usage/RequestLogsPage'
import ProfilePage from './pages/ProfilePage'
import AuditLogPage from './pages/AuditLogPage'
import PlaygroundPage from './pages/PlaygroundPage'
import SystemUsersPage from './pages/SystemUsersPage'
import MCPServersPage from './pages/MCPServersPage'
import MCPLayout from './pages/MCPLayout'
import TeamAccessPanel from './pages/TeamAccessPanel'
import SystemUsagePage from './pages/SystemUsagePage'
import AutoRoutingPage from './pages/AutoRoutingPage'
import SetupPage from './pages/SetupPage'
import ApiAccessLayout from './pages/ApiAccessLayout'
import PlatformLayout from './pages/PlatformLayout'
import { ToastProvider } from './hooks/useToast'
import { ThemeProvider } from './hooks/useTheme'
import { Shell } from './components/layout/Shell'
import { NotFoundPage } from './components/NotFoundPage'
import { LOCAL_STORAGE_KEY } from './lib/constants'
import { useMe } from './hooks/useMe'

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
  if (isLoading) return null
  const isOrgAdmin = data?.role === 'org_admin' || data?.role === 'system_admin'
  return <Navigate to={isOrgAdmin ? 'users' : 'settings'} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/auth/callback" element={<CallbackPage />} />
            <Route path="/invite/:token" element={<AcceptInvitePage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route element={<RequireAuth />}>
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
          </Routes>
        </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
