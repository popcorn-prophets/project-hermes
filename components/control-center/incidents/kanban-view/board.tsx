'use client';

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpDownIcon,
  Clock3Icon,
  GripVerticalIcon,
  Loader2Icon,
  MapPinIcon,
  MessageSquareTextIcon,
  RefreshCwIcon,
  SearchIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from 'lucide-react';
import * as React from 'react';

import {
  INCIDENT_STATUS_DOT_CLASS,
  IncidentSeverityBadge,
  IncidentStatusBadge,
} from '@/components/control-center/incidents/incident-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatDateTime } from '@/lib/date';
import { moveIncidentStatusAction } from '@/lib/incidents/actions';
import {
  formatIncidentSeverityLabel,
  formatIncidentStatusLabel,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  isTerminalIncidentStatus,
  type IncidentBoardEntry,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/lib/incidents/shared';
import { fetchIncidentBoardEntries } from '@/lib/supabase/reports';
import { useIncidentsRealtime } from '@/lib/supabase/use-incidents-realtime';
import { cn } from '@/lib/utils';

type IncidentKanbanBoardProps = {
  onIncidentSelect?: (incidentId: string) => void;
  onOpenFullReport?: (incidentId: string) => void;
};

type IncidentSortOrder = 'desc' | 'asc';

type MoveConfirmationState = {
  incidentId: string;
  currentStatus: IncidentStatus;
  nextStatus: IncidentStatus;
};

type IncidentColumnProps = {
  status: IncidentStatus;
  incidents: IncidentBoardEntry[];
  pendingMoveId: string | null;
  onOpenIncident: (incidentId: string) => void;
  isDragDisabled?: boolean;
  className?: string;
};

type IncidentCardProps = {
  incident: IncidentBoardEntry;
  onOpenIncident?: (incidentId: string) => void;
  isDragDisabled?: boolean;
  isDraggingOverlay?: boolean;
  isMovePending?: boolean;
};

function getIncidentSnippet(incident: IncidentBoardEntry) {
  return (
    incident.locationDescription ||
    incident.description ||
    'No summary available yet.'
  );
}

function compareByIncidentTime(
  left: IncidentBoardEntry,
  right: IncidentBoardEntry,
  sortOrder: IncidentSortOrder
) {
  const leftTime = new Date(left.incidentTime).getTime();
  const rightTime = new Date(right.incidentTime).getTime();

  return sortOrder === 'desc' ? rightTime - leftTime : leftTime - rightTime;
}

function matchesIncidentFilters(
  incident: IncidentBoardEntry,
  searchQuery: string,
  severityFilter: IncidentSeverity | 'all'
) {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const matchesSeverity =
    severityFilter === 'all' || incident.severity === severityFilter;

  if (!matchesSeverity) {
    return false;
  }

  if (!normalizedSearch) {
    return true;
  }

  return [
    incident.id,
    incident.incidentTypeName,
    incident.reporterName,
    incident.locationDescription,
    incident.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(normalizedSearch);
}

function IncidentColumn({
  status,
  incidents,
  pendingMoveId,
  onOpenIncident,
  isDragDisabled = false,
  className,
}: IncidentColumnProps) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
  });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex h-full min-h-0 w-full min-w-0 flex-col rounded-xl border bg-card',
        isOver && !isDragDisabled && 'border-primary shadow-sm',
        className
      )}
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              INCIDENT_STATUS_DOT_CLASS[status]
            )}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {formatIncidentStatusLabel(status)}
            </p>
            <p className="text-xs text-muted-foreground">
              {incidents.length} incident{incidents.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {incidents.length > 0 ? (
          <div className="flex flex-col gap-3">
            {incidents.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                onOpenIncident={onOpenIncident}
                isDragDisabled={isDragDisabled}
                isMovePending={pendingMoveId === incident.id}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed bg-muted/30 px-4 text-center text-sm text-muted-foreground">
            No incidents in this stage.
          </div>
        )}
      </div>
    </section>
  );
}

function IncidentCard({
  incident,
  onOpenIncident,
  isDragDisabled = false,
  isDraggingOverlay = false,
  isMovePending = false,
}: IncidentCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: incident.id,
      data: incident,
      disabled: isDragDisabled,
    });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-xl border bg-background shadow-xs transition-shadow',
        !isDraggingOverlay && 'hover:shadow-sm',
        (isDragging || isDraggingOverlay) && 'shadow-lg'
      )}
    >
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          className="flex flex-1 flex-col gap-3 text-left"
          onClick={() => onOpenIncident?.(incident.id)}
        >
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {incident.incidentTypeName}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(incident.incidentTime)}
              </p>
            </div>
            <IncidentSeverityBadge severity={incident.severity} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <UserRoundIcon />
            <span className="truncate">{incident.reporterName}</span>
          </div>
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {getIncidentSnippet(incident)}
          </p>
        </button>
        {!isDragDisabled ? (
          <button
            type="button"
            className="mt-0.5 rounded-md border border-transparent p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={`Drag ${incident.incidentTypeName}`}
            {...attributes}
            {...listeners}
          >
            {isMovePending ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <GripVerticalIcon />
            )}
          </button>
        ) : isMovePending ? (
          <Loader2Icon className="mt-1 animate-spin text-muted-foreground" />
        ) : null}
      </div>
    </article>
  );
}

function IncidentBoardSkeleton({ isMobile }: { isMobile: boolean }) {
  const columnCount = isMobile ? 1 : INCIDENT_STATUSES.length;
  const containerClassName = isMobile
    ? 'flex min-h-0 flex-1 justify-center overflow-hidden pb-1'
    : 'grid min-h-0 flex-1 grid-cols-5 gap-2 pb-1 xl:gap-4';
  const columnClassName = isMobile ? 'w-full max-w-sm' : 'min-w-0';

  return (
    <div className={containerClassName}>
      {Array.from({ length: columnCount }).map((_, columnIndex) => (
        <div
          key={columnIndex}
          className={cn(
            'flex h-full min-h-0 flex-col rounded-xl border bg-card',
            columnClassName
          )}
        >
          <div className="border-b px-4 py-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
          <div className="flex flex-col gap-3 p-3">
            {Array.from({ length: 4 }).map((_, cardIndex) => (
              <Skeleton key={cardIndex} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IncidentDetailsContent({
  incident,
  isMovePending,
  onClose,
  onMoveStatus,
  onOpenFullReport,
}: {
  incident: IncidentBoardEntry;
  isMovePending: boolean;
  onClose: () => void;
  onMoveStatus: (incidentId: string, nextStatus: IncidentStatus) => void;
  onOpenFullReport: (incidentId: string) => void;
}) {
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Incident
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              {incident.incidentTypeName}
            </h2>
          </div>
          <IncidentStatusBadge status={incident.status} />
        </div>

        <div className="flex flex-wrap gap-2">
          <IncidentSeverityBadge severity={incident.severity} />
          <Badge variant="outline" className="gap-1.5">
            <Clock3Icon />
            {formatDateTime(incident.incidentTime)}
          </Badge>
        </div>

        <div className="grid gap-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-start gap-3">
            <UserRoundIcon className="h-8 w-8mt-0.5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reporter
              </p>
              <p className="text-sm">{incident.reporterName}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPinIcon className="h-9 w-9 mt-0.5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Location
              </p>
              <p className="text-sm text-muted-foreground">
                {incident.locationDescription || 'No location notes provided.'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MessageSquareTextIcon className="h-6 w-6 mt-0.5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Summary
              </p>
              <p className="text-sm text-muted-foreground">
                {incident.description || 'No incident description provided.'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Move Incident
          </p>
          <Select
            disabled={isMovePending}
            value={incident.status}
            onValueChange={(value) =>
              onMoveStatus(incident.id, value as IncidentStatus)
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a stage" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {INCIDENT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {formatIncidentStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Status changes save immediately. Terminal stages require one extra
            confirmation.
          </p>
        </div>
      </div>

      <div className="border-t" />

      <div className="px-4 pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onOpenFullReport(incident.id)}>
            Open full report
          </Button>
        </div>
      </div>
    </>
  );
}

export default function IncidentKanbanBoard({
  onIncidentSelect,
  onOpenFullReport,
}: IncidentKanbanBoardProps) {
  const isMobile = useIsMobile();
  const [incidents, setIncidents] = React.useState<IncidentBoardEntry[]>([]);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [severityFilter, setSeverityFilter] = React.useState<
    IncidentSeverity | 'all'
  >('all');
  const [sortOrder, setSortOrder] = React.useState<IncidentSortOrder>('desc');
  const [selectedIncidentId, setSelectedIncidentId] = React.useState<
    string | null
  >(null);
  const [activeStatus, setActiveStatus] = React.useState<IncidentStatus>('new');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [pendingMoveId, setPendingMoveId] = React.useState<string | null>(null);
  const [moveConfirmation, setMoveConfirmation] =
    React.useState<MoveConfirmationState | null>(null);
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const incidentsById = React.useMemo(
    () => new Map(incidents.map((incident) => [incident.id, incident])),
    [incidents]
  );

  const selectedIncident = selectedIncidentId
    ? (incidentsById.get(selectedIncidentId) ?? null)
    : null;

  const filteredIncidents = React.useMemo(
    () =>
      incidents.filter((incident) =>
        matchesIncidentFilters(incident, searchQuery, severityFilter)
      ),
    [incidents, searchQuery, severityFilter]
  );

  const groupedIncidents = React.useMemo(() => {
    const groups = Object.fromEntries(
      INCIDENT_STATUSES.map((status) => [status, [] as IncidentBoardEntry[]])
    ) as Record<IncidentStatus, IncidentBoardEntry[]>;

    filteredIncidents.forEach((incident) => {
      groups[incident.status].push(incident);
    });

    INCIDENT_STATUSES.forEach((status) => {
      groups[status].sort((left, right) =>
        compareByIncidentTime(left, right, sortOrder)
      );
    });

    return groups;
  }, [filteredIncidents, sortOrder]);

  const loadIncidents = React.useCallback(async () => {
    setLoading(true);
    setActionError(null);

    try {
      const entries = await fetchIncidentBoardEntries();
      setIncidents(entries);
      setSelectedIncidentId((currentId) =>
        currentId && !entries.some((incident) => incident.id === currentId)
          ? null
          : currentId
      );
    } catch (error) {
      console.error('Failed to load incident board:', error);
      setActionError('Unable to load incidents right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  useIncidentsRealtime(loadIncidents);

  React.useEffect(() => {
    if (!selectedIncidentId && detailsOpen) {
      setDetailsOpen(false);
    }
  }, [detailsOpen, selectedIncidentId]);

  const openIncident = React.useCallback(
    (incidentId: string) => {
      setSelectedIncidentId(incidentId);
      setDetailsOpen(true);
      onIncidentSelect?.(incidentId);
    },
    [onIncidentSelect]
  );

  const handleOpenFullReport = React.useCallback(
    (incidentId: string) => {
      setDetailsOpen(false);
      onIncidentSelect?.(incidentId);
      onOpenFullReport?.(incidentId);
    },
    [onIncidentSelect, onOpenFullReport]
  );

  const persistIncidentMove = React.useCallback(
    async (
      incidentId: string,
      nextStatus: IncidentStatus,
      previousIncidents: IncidentBoardEntry[]
    ) => {
      const result = await moveIncidentStatusAction({
        incidentId,
        nextStatus,
      });

      if (result.status === 'success') {
        setIncidents((currentIncidents) =>
          currentIncidents.map((incident) =>
            incident.id === incidentId
              ? {
                  ...incident,
                  status: result.nextStatus,
                }
              : incident
          )
        );
        setActionError(null);
        return;
      }

      setIncidents(previousIncidents);
      setActionError(result.message);

      if (selectedIncidentId === incidentId) {
        const previousIncident = previousIncidents.find(
          (incident) => incident.id === incidentId
        );

        if (previousIncident) {
          setActiveStatus(previousIncident.status);
        }
      }
    },
    [selectedIncidentId]
  );

  const commitIncidentMove = React.useCallback(
    (incidentId: string, nextStatus: IncidentStatus) => {
      if (pendingMoveId) {
        return;
      }

      const currentIncident = incidentsById.get(incidentId);

      if (!currentIncident || currentIncident.status === nextStatus) {
        return;
      }

      const previousIncidents = incidents;

      setPendingMoveId(incidentId);
      setIncidents((currentIncidents) =>
        currentIncidents.map((incident) =>
          incident.id === incidentId
            ? {
                ...incident,
                status: nextStatus,
              }
            : incident
        )
      );

      if (selectedIncidentId === incidentId) {
        setActiveStatus(nextStatus);
      }

      startTransition(() => {
        void persistIncidentMove(
          incidentId,
          nextStatus,
          previousIncidents
        ).finally(() => {
          setPendingMoveId(null);
        });
      });
    },
    [
      incidents,
      incidentsById,
      pendingMoveId,
      persistIncidentMove,
      selectedIncidentId,
    ]
  );

  const requestIncidentMove = React.useCallback(
    (incidentId: string, nextStatus: IncidentStatus) => {
      const incident = incidentsById.get(incidentId);

      if (!incident || incident.status === nextStatus || pendingMoveId) {
        return;
      }

      if (isTerminalIncidentStatus(nextStatus)) {
        setMoveConfirmation({
          incidentId,
          currentStatus: incident.status,
          nextStatus,
        });
        return;
      }

      commitIncidentMove(incidentId, nextStatus);
    },
    [commitIncidentMove, incidentsById, pendingMoveId]
  );

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);

      const overId = event.over?.id;

      if (!overId) {
        return;
      }

      requestIncidentMove(String(event.active.id), overId as IncidentStatus);
    },
    [requestIncidentMove]
  );

  const handleDragCancel = React.useCallback(() => {
    setActiveDragId(null);
  }, []);

  const activeIncident = activeDragId ? incidentsById.get(activeDragId) : null;
  const mobileStatusCount = groupedIncidents[activeStatus].length;

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-0 flex-col gap-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 md:flex-row">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full pl-9"
                placeholder="Search reporter, incident type, or summary"
              />
            </div>
            <Select
              value={severityFilter}
              onValueChange={(value) =>
                setSeverityFilter(value as IncidentSeverity | 'all')
              }
            >
              <SelectTrigger className="w-full md:w-56">
                <SelectValue placeholder="Filter by severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All severities</SelectItem>
                  {INCIDENT_SEVERITIES.map((severity) => (
                    <SelectItem key={severity} value={severity}>
                      {formatIncidentSeverityLabel(severity)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {isMobile ? (
              <Select
                value={activeStatus}
                onValueChange={(value) =>
                  setActiveStatus(value as IncidentStatus)
                }
              >
                <SelectTrigger className="w-full md:w-56">
                  <SelectValue placeholder="Switch stage" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {INCIDENT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {formatIncidentStatusLabel(status)} (
                        {groupedIncidents[status].length})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setSortOrder((currentOrder) =>
                  currentOrder === 'desc' ? 'asc' : 'desc'
                )
              }
            >
              <ArrowUpDownIcon data-icon="inline-start" />
              {sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadIncidents()}
              disabled={loading}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={cn(loading && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Showing {filteredIncidents.length} of {incidents.length} incidents
          </span>
          {isMobile ? (
            <span>
              Current stage: {formatIncidentStatusLabel(activeStatus)} (
              {mobileStatusCount})
            </span>
          ) : null}
        </div>

        {actionError ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <TriangleAlertIcon className="mt-0.5" />
            <p>{actionError}</p>
          </div>
        ) : null}
      </div>

      {loading ? (
        <IncidentBoardSkeleton isMobile={isMobile} />
      ) : (
        <DndContext
          collisionDetection={closestCorners}
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          {isMobile ? (
            <div className="flex min-h-0 flex-1 justify-center overflow-hidden pb-1">
              <IncidentColumn
                status={activeStatus}
                incidents={groupedIncidents[activeStatus]}
                pendingMoveId={pendingMoveId}
                onOpenIncident={openIncident}
                isDragDisabled
                className="w-full max-w-sm"
              />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1 pb-1">
              <div className="flex h-full min-h-0 w-max min-w-full gap-2 pr-1 xl:gap-4">
                {INCIDENT_STATUSES.map((status) => (
                  <IncidentColumn
                    key={status}
                    status={status}
                    incidents={groupedIncidents[status]}
                    pendingMoveId={pendingMoveId}
                    onOpenIncident={openIncident}
                    className="w-80 min-w-80"
                  />
                ))}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
          <DragOverlay>
            {activeIncident ? (
              <div className="w-full max-w-sm">
                <IncidentCard incident={activeIncident} isDraggingOverlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {selectedIncident ? (
        isMobile ? (
          <Drawer open={detailsOpen} onOpenChange={setDetailsOpen}>
            <DrawerContent className="max-h-[85vh]">
              <DrawerHeader>
                <DrawerTitle>Incident Details</DrawerTitle>
                <DrawerDescription>
                  Review the incident and move it to another stage
                </DrawerDescription>
              </DrawerHeader>
              <IncidentDetailsContent
                incident={selectedIncident}
                isMovePending={pendingMoveId === selectedIncident.id}
                onClose={() => setDetailsOpen(false)}
                onMoveStatus={requestIncidentMove}
                onOpenFullReport={handleOpenFullReport}
              />
            </DrawerContent>
          </Drawer>
        ) : (
          <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
            <SheetContent className="w-full sm:max-w-lg">
              <SheetHeader>
                <SheetTitle>Incident quick details</SheetTitle>
                <SheetDescription>
                  Review the incident and move it to another stage
                </SheetDescription>
              </SheetHeader>
              <IncidentDetailsContent
                incident={selectedIncident}
                isMovePending={pendingMoveId === selectedIncident.id}
                onClose={() => setDetailsOpen(false)}
                onMoveStatus={requestIncidentMove}
                onOpenFullReport={handleOpenFullReport}
              />
            </SheetContent>
          </Sheet>
        )
      ) : null}

      <Dialog
        open={Boolean(moveConfirmation)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setMoveConfirmation(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm terminal status change</DialogTitle>
            <DialogDescription>
              {moveConfirmation
                ? `Move this incident from ${formatIncidentStatusLabel(
                    moveConfirmation.currentStatus
                  )} to ${formatIncidentStatusLabel(
                    moveConfirmation.nextStatus
                  )}?`
                : 'Move this incident to a terminal stage?'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveConfirmation(null)}>
              Cancel
            </Button>
            <Button
              variant={
                moveConfirmation?.nextStatus === 'dismissed'
                  ? 'destructive'
                  : 'default'
              }
              onClick={() => {
                if (!moveConfirmation) {
                  return;
                }

                commitIncidentMove(
                  moveConfirmation.incidentId,
                  moveConfirmation.nextStatus
                );
                setMoveConfirmation(null);
              }}
            >
              Confirm move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
