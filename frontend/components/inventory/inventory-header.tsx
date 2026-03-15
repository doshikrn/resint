import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type StationOption = { id: number; name: string; department: "kitchen" | "bar" };

type InventoryHeaderProps = {
  stations: StationOption[];
  selectedStationId: number | null;
  stationsLoading: boolean;
  onSelectStation: (value: number | null) => void;
};

export function InventoryHeader({
  stations,
  selectedStationId,
  stationsLoading,
  onSelectStation,
}: InventoryHeaderProps) {
  const kitchenStations = stations.filter((station) => station.department === "kitchen");
  const barStations = stations.filter((station) => station.department === "bar");
  const selectedStation = stations.find((station) => station.id === selectedStationId) ?? null;

  return (
    <header className="rounded-2xl border border-muted bg-card/90 px-4 py-3 shadow-sm">
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Станция</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                data-testid="inventory-station-select"
                disabled={stationsLoading || stations.length === 0}
                className="h-11 w-full justify-between rounded-xl border-input bg-background px-3 text-sm font-normal shadow-sm"
              >
                <span className="truncate text-left">
                  {stationsLoading
                    ? "Загрузка станций..."
                    : selectedStation
                      ? selectedStation.name
                      : "Станция не выбрана"}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 sm:min-w-[22rem] max-w-[calc(100vw-2rem)]">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Текущая станция
              </DropdownMenuLabel>
              <div className="px-2 pb-2 text-sm font-medium">{selectedStation ? selectedStation.name : "Не выбрана"}</div>

              <DropdownMenuSeparator />

              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Выбрать станцию
              </DropdownMenuLabel>

              <DropdownMenuRadioGroup
                value={selectedStationId !== null ? String(selectedStationId) : undefined}
                onValueChange={(value) => {
                  onSelectStation(Number(value));
                }}
              >
                {kitchenStations.length > 0 ? (
                  <>
                    {barStations.length > 0 ? (
                      <DropdownMenuLabel className="pb-0 pt-1 text-xs font-medium text-muted-foreground">Кухня</DropdownMenuLabel>
                    ) : null}
                    {kitchenStations.map((station) => (
                      <DropdownMenuRadioItem key={station.id} value={String(station.id)}>
                        {station.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </>
                ) : null}

                {barStations.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="pb-0 pt-1 text-xs font-medium text-muted-foreground">Бар</DropdownMenuLabel>
                    {barStations.map((station) => (
                      <DropdownMenuRadioItem key={station.id} value={String(station.id)}>
                        {station.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </>
                ) : null}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
