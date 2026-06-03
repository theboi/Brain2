/*
 * Icon — thin wrapper around lucide-react.
 * Size defaults to 18, stroke-width to 1.75 (matching the design prototype).
 */
import {
  AlertTriangle, ArrowRight, AtSign, BarChart2, Bell, Briefcase,
  Calendar, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  Clock, Cloud, Code2, Command, Copy, Download, Edit3, ExternalLink,
  File, Filter, Folder, Globe, Hash, History, Home, Image, Key,
  Layers, Link2, Loader2, LogOut, Mail, MoreHorizontal, Moon,
  Paperclip, Pause, Pencil, Pin, Play, Plug, Plus, Presentation,
  RefreshCw, Search, Send, Settings, Shield, Slash, Sliders,
  Sparkles, Square, Star, Sun, Tag, Trash2, TrendingUp, User,
  Users, Wand2, X, Zap, MessageSquare,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';

const ICON_MAP = {
  home: Home,
  sources: Layers,
  wiki: Star,
  chats: MessageSquare,
  settings: Settings,
  search: Search,
  plus: Plus,
  more: MoreHorizontal,
  check: CheckCircle2,
  alert: AlertTriangle,
  clock: Clock,
  loader: Loader2,
  chevDown: ChevronDown,
  chevRight: ChevronRight,
  chevLeft: ChevronLeft,
  arrowRight: ArrowRight,
  sun: Sun,
  moon: Moon,
  command: Command,
  sparkles: Sparkles,
  file: File,
  folder: Folder,
  zap: Zap,
  cloud: Cloud,
  cpu: Sliders,
  pause: Pause,
  copy: Copy,
  pencil: Pencil,
  download: Download,
  x: X,
  tag: Tag,
  hash: Hash,
  image: Image,
  code: Code2,
  link: Link2,
  refresh: RefreshCw,
  globe: Globe,
  history: History,
  panelLeft: Presentation,
  filter: Filter,
  send: Send,
  atSign: AtSign,
  slash: Slash,
  stop: Square,
  thumbUp: Star,
  thumbDown: Star,
  user: User,
  users: Users,
  key: Key,
  mail: Mail,
  plug: Plug,
  logout: LogOut,
  shield: Shield,
  pin: Pin,
  trash: Trash2,
  bell: Bell,
  external: ExternalLink,
  play: Play,
  barChart: BarChart2,
  trendingUp: TrendingUp,
  calendar: Calendar,
  briefcase: Briefcase,
  sliders: Sliders,
  layers: Layers,
  wand: Wand2,
  clipboard: Paperclip,
  edit: Edit3,
} as const;

export type IconName = keyof typeof ICON_MAP;

interface IconProps extends Omit<LucideProps, 'ref'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  const Component = ICON_MAP[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={strokeWidth} {...rest} />;
}
