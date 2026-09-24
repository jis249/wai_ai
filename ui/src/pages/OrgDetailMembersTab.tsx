import { useParams } from 'react-router-dom'
import { OrgMembersPanel } from '../components/members/OrgMembersPanel'

/** /orgs/:orgId/members: system-admin view of any organization's members. */
export default function OrgDetailMembersTab() {
  const { orgId = '' } = useParams<{ orgId: string }>()
  return <OrgMembersPanel orgId={orgId} />
}
