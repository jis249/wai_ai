/**
 * Single import point for icons (lucide-react). Import from here, not from
 * 'lucide-react' directly, so the set stays curated and tree-shaken:
 *
 *   import { Trash2, Pencil } from '../components/ui/icons'
 *   <Trash2 className="h-4 w-4" aria-hidden="true" />
 *
 * Lucide icons are 24x24, stroke="currentColor", strokeWidth 2 by default (pass
 * `strokeWidth={1.75}` to match the existing inline icons). Size with className.
 *
 * Mapping from the legacy inline SVG components in pages/ → lucide name:
 *   IconActivity → Activity          IconAlertTriangle → TriangleAlert
 *   IconBarChart → ChartColumn       IconBot / IconBotLarge → Bot
 *   IconBuilding → Building2         IconCheck → Check
 *   IconCheckCircle → CircleCheck    IconChevronDown → ChevronDown
 *   IconClock → Clock                IconCloud → Cloud
 *   IconCopy → Copy                  IconCpu → Cpu
 *   IconCube → Box                   IconDashboard → LayoutDashboard
 *   IconDollar / IconDollarSign → DollarSign
 *   IconDownload → Download          IconEye → Eye
 *   IconGroup / IconTeam / IconTeamLarge / IconUsers → Users
 *   IconHealthDot → (keep: status dot, not an icon)
 *   IconHeartPulse → HeartPulse      IconKey → KeyRound
 *   IconLayers → Layers              IconList → List
 *   IconMemory → MemoryStick         IconMoon → Moon
 *   IconPauseCircle → CirclePause    IconPencil → Pencil
 *   IconPerson / IconUser → User     IconPersonPlus → UserPlus
 *   IconPlug → Plug                  IconRefresh → RefreshCw
 *   IconServer → Server              IconShield → Shield
 *   IconStorage → HardDrive          IconSun → Sun
 *   IconTerminal → Terminal          IconTrash → Trash2
 *   IconTrendingDown → TrendingDown  IconXCircle → CircleX
 *   IconZap → Zap
 */
export type { LucideIcon, LucideProps } from 'lucide-react'

export {
  // Status / feedback
  Activity,
  CircleAlert,
  CircleCheck,
  CircleX,
  CirclePause,
  CirclePlay,
  Info,
  LoaderCircle,
  TriangleAlert,
  HeartPulse,
  // Actions
  Check,
  Copy,
  Download,
  Upload,
  Ellipsis,
  EllipsisVertical,
  ExternalLink,
  Eye,
  EyeOff,
  Filter,
  Link,
  Unlink,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
  // Navigation / chevrons
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  // Domain objects
  Bot,
  Box,
  Building2,
  Cloud,
  Cpu,
  Database,
  FileText,
  Gauge,
  Globe,
  HardDrive,
  Hash,
  History,
  KeyRound,
  Layers,
  LayoutDashboard,
  List,
  Lock,
  Mail,
  MemoryStick,
  MessageSquare,
  Network,
  Plug,
  Unplug,
  Route,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
  Wrench,
  Zap,
  // People
  User,
  UserMinus,
  UserPlus,
  Users,
  // Money / metrics / time
  ChartColumn,
  ChartLine,
  ChartPie,
  Coins,
  DollarSign,
  IndianRupee,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
  Calendar,
  Clock,
  Timer,
  // Theme
  Keyboard,
  Moon,
  Sun,
  // Alerts
  Bell,
  BellRing,
  Send,
  OctagonAlert,
} from 'lucide-react'
