import {
  Archive,
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  AudioLines,
  Binary,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clipboard,
  Clock,
  Code,
  Copy,
  CopyPlus,
  Cpu,
  Crop,
  Download,
  Eye,
  ExternalLink,
  FileImage,
  FileText,
  Film,
  FolderOpen,
  GripVertical,
  House,
  Image,
  ImagePlus,
  Images,
  Info,
  Keyboard,
  Layers,
  LayoutGrid,
  Link,
  ListOrdered,
  LoaderCircle,
  Lock,
  MapPin,
  Menu,
  Merge,
  Minus,
  Monitor,
  Moon,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  Scaling,
  ScanEye,
  Scissors,
  Search,
  Settings,
  Sheet,
  ShieldCheck,
  Shrink,
  Sparkles,
  Split,
  Star,
  Sun,
  Trash,
  TriangleAlert,
  Undo,
  Upload,
  VolumeX,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
  Stamp,
  SlidersHorizontal,
  Combine,
  Grid3x3,
  AppWindow,
  GalleryHorizontal,
  Gauge,
  Type,
  FileDigit,
  Wrench,
  Fingerprint,
  FileCode,
  FileCode2,
  Table,
  ListMusic,
  Volume2,
  Waves,
  Rewind,
  Package,
  Shapes,
  Presentation,
  Proportions,
  FilePlus,
  ListPlus,
  KeyRound,
  LayoutList,
  ArrowLeftRight as Convert,
  type LucideIcon,
} from 'lucide-preact';
import type { IconName } from '../../registry/types';

type UiIcon =
  | 'search'
  | 'upload'
  | 'shield'
  | 'lock'
  | 'home'
  | 'settings'
  | 'info'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'check'
  | 'download'
  | 'trash'
  | 'retry'
  | 'star'
  | 'menu'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'clock'
  | 'copy'
  | 'grip'
  | 'flip-h'
  | 'flip-v'
  | 'rotate-left'
  | 'rotate-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'plus'
  | 'minus'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'warning'
  | 'error'
  | 'success'
  | 'spinner'
  | 'layers'
  | 'play'
  | 'pause'
  | 'sparkles'
  | 'keyboard'
  | 'undo'
  | 'reverse'
  | 'duplicate'
  | 'folder'
  | 'eye'
  | 'map-pin'
  | 'cpu'
  | 'offline'
  | 'clipboard'
  | 'external'
  | 'file'
  | 'repeat'
  | 'file-plus'
  | 'key'
  | 'list';

export type AnyIcon = IconName | UiIcon;

const ICONS: Record<AnyIcon, LucideIcon> = {
  // tools
  image: Image,
  images: Images,
  compress: Shrink,
  resize: Scaling,
  crop: Crop,
  rotate: RotateCw,
  metadata: ScanEye,
  pdf: FileText,
  merge: Merge,
  split: Split,
  pages: LayoutGrid,
  'pdf-image': FileImage,
  'image-pdf': ImagePlus,
  video: Film,
  audio: AudioLines,
  music: Music,
  trim: Scissors,
  mute: VolumeX,
  gif: Sparkles,
  archive: Archive,
  extract: FolderOpen,
  json: Braces,
  csv: Sheet,
  xml: Code,
  base64: Binary,
  link: Link,
  convert: Convert,
  watermark: Stamp,
  adjust: SlidersHorizontal,
  combine: Combine,
  grid: Grid3x3,
  favicon: AppWindow,
  frames: GalleryHorizontal,
  speed: Gauge,
  text: Type,
  numbers: FileDigit,
  repair: Wrench,
  hash: Fingerprint,
  yaml: FileCode,
  markdown: FileCode2,
  table: Table,
  'music-plus': ListMusic,
  volume: Volume2,
  fade: Waves,
  'reverse-audio': Rewind,
  package: Package,
  shapes: Shapes,
  slideshow: Presentation,
  ratio: Proportions,
  join: ListPlus,
  // ui
  search: Search,
  upload: Upload,
  shield: ShieldCheck,
  lock: Lock,
  home: House,
  settings: Settings,
  info: Info,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  close: X,
  check: Check,
  download: Download,
  trash: Trash,
  retry: RefreshCw,
  star: Star,
  menu: Menu,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  clock: Clock,
  copy: Copy,
  grip: GripVertical,
  'flip-h': ArrowLeftRight,
  'flip-v': ArrowUpDown,
  'rotate-left': RotateCcw,
  'rotate-right': RotateCw,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
  plus: Plus,
  minus: Minus,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  warning: TriangleAlert,
  error: CircleAlert,
  success: CircleCheck,
  spinner: LoaderCircle,
  layers: Layers,
  play: Play,
  pause: Pause,
  sparkles: Sparkles,
  keyboard: Keyboard,
  undo: Undo,
  reverse: ListOrdered,
  duplicate: CopyPlus,
  folder: FolderOpen,
  eye: Eye,
  'map-pin': MapPin,
  cpu: Cpu,
  offline: WifiOff,
  clipboard: Clipboard,
  external: ExternalLink,
  file: FileText,
  repeat: Repeat,
  'file-plus': FilePlus,
  key: KeyRound,
  list: LayoutList,
};

export function Icon({ name, size, class: className }: { name: AnyIcon; size?: number; class?: string }) {
  const Component = ICONS[name] ?? CircleX;
  return <Component aria-hidden={true} strokeWidth={1.9} {...(size ? { size } : {})} {...(className ? { class: className } : {})} />;
}
