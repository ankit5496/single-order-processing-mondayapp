import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Package, MapPin, Clock, CheckCircle, Truck, AlertCircle, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

// ─── Types matching Shiprocket API response ───────────────────────────────────
type ShipmentTrack = {
  id: number;
  awb_code: string;
  courier_company_id: number;
  shipment_id: number;
  order_id: number;
  pickup_date: string | null;
  delivered_date: string | null;
  weight: string;
  packages: number;
  current_status: string;
  delivered_to: string;
  destination: string;
  consignee_name: string;
  origin: string;
  courier_agent_details: string | null;
  edd: string;
};

type ShipmentActivity = {
  date: string;
  status: string;
  activity: string;
  location: string;
  "sr-status": string;
};

type TrackingData = {
  track_status: number;
  shipment_status: number;
  shipment_track: ShipmentTrack[];
  shipment_track_activities: ShipmentActivity[];
  track_url: string;
  etd: string;
};

type TrackingResponse = {
  tracking_data: TrackingData;
};

// ─── Static data (replace with API call in future) ────────────────────────────
const STATIC_TRACKING_DATA: TrackingResponse[] = [
  {
    tracking_data: {
      track_status: 1,
      shipment_status: 42,
      shipment_track: [
        {
          id: 185584215,
          awb_code: "1091188857722",
          courier_company_id: 10,
          shipment_id: 168347943,
          order_id: 168807908,
          pickup_date: null,
          delivered_date: null,
          weight: "0.10",
          packages: 1,
          current_status: "PICKED UP",
          delivered_to: "Mumbai",
          destination: "Mumbai",
          consignee_name: "Musarrat",
          origin: "PALWAL",
          courier_agent_details: null,
          edd: "2021-12-27 23:23:18",
        },
      ],
      shipment_track_activities: [
        {
          date: "2021-12-23 14:23:18",
          status: "X-PPOM",
          activity: "In Transit - Shipment picked up",
          location: "Palwal_NewColony_D (Haryana)",
          "sr-status": "42",
        },
        {
          date: "2021-12-23 14:19:37",
          status: "FMPUR-101",
          activity: "Manifested - Pickup scheduled",
          location: "Palwal_NewColony_D (Haryana)",
          "sr-status": "NA",
        },
        {
          date: "2021-12-23 14:19:34",
          status: "X-UCI",
          activity: "Manifested - Consignment Manifested",
          location: "Palwal_NewColony_D (Haryana)",
          "sr-status": "5",
        },
      ],
      track_url: "https://shiprocket.co//tracking/1091188857722",
      etd: "2021-12-28 10:19:35",
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getStatusColor(srStatus: string): string {
  const s = parseInt(srStatus);
  if (srStatus === "NA") return "bg-gray-400";
  if (s >= 40 && s < 50) return "bg-blue-500";   // in transit
  if (s === 7)            return "bg-green-500";  // delivered
  if (s >= 5 && s < 10)  return "bg-yellow-500"; // manifested
  return "bg-gray-400";
}

function getStatusIcon(srStatus: string) {
  const s = parseInt(srStatus);
  if (srStatus === "NA") return <Clock className="w-4 h-4 text-white" />;
  if (s >= 40 && s < 50) return <Truck className="w-4 h-4 text-white" />;
  if (s === 7)            return <CheckCircle className="w-4 h-4 text-white" />;
  return <Package className="w-4 h-4 text-white" />;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function getCurrentStatusBadge(status: string) {
  const map: Record<string, { color: string; label: string }> = {
    "PICKED UP":  { color: "bg-blue-100 text-blue-700 border-blue-200",   label: "Picked Up" },
    "IN TRANSIT": { color: "bg-yellow-100 text-yellow-700 border-yellow-200", label: "In Transit" },
    "DELIVERED":  { color: "bg-green-100 text-green-700 border-green-200",  label: "Delivered" },
    "PENDING":    { color: "bg-gray-100 text-gray-700 border-gray-200",    label: "Pending" },
  };
  const entry = map[status.toUpperCase()] || { color: "bg-gray-100 text-gray-700 border-gray-200", label: status };
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${entry.color}`}>
      {entry.label}
    </span>
  );
}

// ─── Progress Steps ───────────────────────────────────────────────────────────
const PROGRESS_STEPS = [
  { label: "Order Placed",  icon: <Package className="w-5 h-5" />,      srStatus: "1"  },
  { label: "Manifested",    icon: <AlertCircle className="w-5 h-5" />,  srStatus: "5"  },
  { label: "Picked Up",     icon: <Truck className="w-5 h-5" />,        srStatus: "42" },
  { label: "In Transit",    icon: <Truck className="w-5 h-5" />,        srStatus: "44" },
  { label: "Delivered",     icon: <CheckCircle className="w-5 h-5" />,  srStatus: "7"  },
];

function getActiveStep(activities: ShipmentActivity[]): number {
  for (const act of activities) {
    const s = parseInt(act["sr-status"]);
    if (!isNaN(s)) {
      if (s >= 42) return 2; // picked up / in transit  ← moved UP
      if (s === 7) return 4; // delivered
      if (s >= 5)  return 1; // manifested
      if (s >= 1)  return 0; // order placed
    }
  }
  return 0;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function OrderTracking() {
  const [itemId, setItemId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const monday = mondaySdk();

  const LOCAL_TEST = process.env.REACT_APP_LOCAL_TEST === "true";
  const LOCAL_ITEM_ID = Number(process.env.REACT_APP_LOCAL_ITEM_ID);

  useEffect(() => {
    if (LOCAL_TEST && LOCAL_ITEM_ID) {
      setItemId(LOCAL_ITEM_ID);
      return;
    }
    monday.get("context").then((res) => {
      const context = res.data as any;
      if (context && "itemId" in context) {
        setItemId(Number(context.itemId));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // TODO: replace STATIC_TRACKING_DATA with API call using itemId
  const trackingResponse = STATIC_TRACKING_DATA[0];
  const td = trackingResponse.tracking_data;
  const track = td.shipment_track[0];
  const activities = td.shipment_track_activities;
  const activeStep = getActiveStep(activities);
  const visibleActivities = expanded ? activities : activities.slice(0, 2);
  const hasMore = activities.length > 2;

  return (
    <div className="p-6 grid gap-6 max-w-4xl mx-auto">

      {/* ── Header Card ── */}
      <Card className="shadow-lg rounded-2xl border-2 border-gray-300">
        <CardHeader className="border-b-2 border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-2xl">
          <CardTitle className="text-xl font-bold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Truck className="w-6 h-6 text-blue-600" />
              Shipment Tracking
            </div>
            {getCurrentStatusBadge(track.current_status)}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm pt-4">
          <div className="flex gap-2">
            <span className="font-semibold text-gray-500">AWB Number</span>
            <span className="text-gray-800 font-mono">{track.awb_code}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-500">Consignee</span>
            <span className="text-gray-800">{track.consignee_name}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-500">Origin</span>
            <span className="text-gray-800">{track.origin}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-500">Destination</span>
            <span className="text-gray-800">{track.destination}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-500">Weight</span>
            <span className="text-gray-800">{track.weight} kg</span>
          </div>
          <div className="flex gap-2">
            <span className="font-semibold text-gray-500">Est. Delivery</span>
            <span className="text-gray-800">{formatDate(track.edd)}</span>
          </div>
          <div className="col-span-2 flex gap-2 items-center">
            <span className="font-semibold text-gray-500">Track URL</span>
            <a
              href={td.track_url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-1"
            >
              {td.track_url} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </CardContent>
      </Card>

      {/* ── Progress Bar ── */}
      <Card className="shadow-lg rounded-2xl border-2 border-gray-300">
        <CardHeader className="border-b-2 border-gray-200">
          <CardTitle className="text-base font-semibold text-gray-700">Shipment Progress</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 pb-4">
          <div className="flex items-start justify-between relative px-5">
            {/* grey base line — runs between first and last icon centers */}
            <div className="absolute top-5 left-5 right-5 h-1 bg-gray-200 z-0" />

            {/* blue filled line — grows from first icon center to active icon center */}
            <div
              className="absolute top-5 left-5 h-1 bg-blue-500 z-0 transition-all duration-500"
              style={{
                width: activeStep === 0
                  ? '0%'
                  : `${(activeStep / (PROGRESS_STEPS.length - 1)) * 100}%`,
              }}
            />

            {PROGRESS_STEPS.map((step, i) => {
              const done    = i <= activeStep;
              const current = i === activeStep;
              return (
                <div key={i} className="flex flex-col items-center z-10 flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300
                      ${ done
                          ? current
                            ? 'bg-blue-500 border-blue-500 ring-4 ring-blue-100'
                            : 'bg-blue-500 border-blue-500'
                          : 'bg-white border-gray-300'
                      }`}
                  >
                    <span className={done ? 'text-white' : 'text-gray-400'}>
                      {step.icon}
                    </span>
                  </div>
                  <span
                    className={`mt-2 text-xs font-medium text-center leading-tight ${
                      current ? 'text-blue-600 font-semibold' : done ? 'text-blue-500' : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Activity Timeline ── */}
      <Card className="shadow-lg rounded-2xl border-2 border-gray-300">
        <CardHeader className="border-b-2 border-gray-200">
          <CardTitle className="text-base font-semibold text-gray-700 flex items-center gap-2">
            <Clock className="w-5 h-5 text-gray-500" />
            Tracking Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="relative">
            <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200" />
            <div className="space-y-0">
              {visibleActivities.map((act, i) => {
                const isFirst = i === 0;
                const srStatus = act["sr-status"];
                const dotColor = getStatusColor(srStatus);
                return (
                  <div key={i} className="flex gap-4 relative pb-6 last:pb-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${dotColor} ${isFirst ? "shadow-md" : ""}`}>
                      {getStatusIcon(srStatus)}
                    </div>
                    <div className={`flex-1 rounded-xl p-3 border ${isFirst ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className={`font-semibold text-sm ${isFirst ? "text-blue-800" : "text-gray-800"}`}>
                            {act.activity}
                          </p>
                          <div className="flex items-center gap-1 mt-1">
                            <MapPin className="w-3 h-3 text-gray-400" />
                            <span className="text-xs text-gray-500">{act.location}</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-gray-500">{formatDate(act.date)}</p>
                          <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded mt-1 inline-block">
                            {act.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors text-sm font-medium"
            >
              {expanded ? (
                <><ChevronUp className="w-4 h-4" /> Show less</>
              ) : (
                <><ChevronDown className="w-4 h-4" /> Show {activities.length - 2} more {activities.length - 2 === 1 ? "activity" : "activities"}</>
              )}
            </button>
          )}
        </CardContent>
      </Card>

      {/* ── ETD Card ── */}
      <Card className="shadow-lg rounded-2xl border-2 border-green-200 bg-green-50">
        <CardContent className="pt-4 pb-4 flex items-center gap-3">
          <CheckCircle className="w-8 h-8 text-green-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">Estimated Time of Delivery</p>
            <p className="text-green-700 text-sm">{formatDate(td.etd)}</p>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
