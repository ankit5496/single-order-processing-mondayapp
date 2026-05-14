import React from "react";
import Select from "react-select";
import mondaySdk from "monday-sdk-js";
import { Button } from "./components/ui/button";
import toast, { Toaster } from "react-hot-toast";
import { useEffect, useState } from "react";
import { CheckCircle, Loader2 } from "lucide-react";
import { ConfirmDialog } from "./components/ui/confirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

type Order = {
  id: string;
  name: string;
  orderId: string;
  date: string;
  status: string;
  description: string;
  customerPostalCode: string;
  totalPrice: string;
};

type Supplier = {
  supplier_id: string;
  supplier_name: string;
  postal_code: string;
  supplier_address: string;
  supplier_phone: string;
  rate: string | null;
  weight: string;
  rating: string;
  rankText?: string;
  color?: string;
  backgroundColor?: string;
};

type Courier = {
  courier_id: string;
  courier_name: string;
  estimated_delivery_days: number;
  rating: number;
  freight_charge: number;
  rankText: string;
};

type LineItem = {
  id: string;
  name: string;
  product: string;
  product_id: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  status: string;
  courierName?: string;
  supplierId?: string;
  supplierName?: string;
  courierId?: string;
  suppliers: Supplier[];
  availableCouriers?: Courier[];
};

type CustomerData = {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  postal_code: string;
};

type ApiResponse = {
  order: Order;
  lineitems: LineItem[];
  customer: CustomerData;
};

type GroupedManifests = {
  key: string;
  supplierId: string;
  courierId: string;
  items: LineItem[];
};

interface CourierCompany {
  courier_company_id: string;
  courier_name: string;
  estimated_delivery_days: number;
  rating: number;
  freight_charge: number;
}

export default function OrderDetail() {
  const [order, setOrder] = useState<Order | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [customer_info, setCustomerData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [buttonLoading, setButtonLoading] = useState(false);
  const [itemId, setItemId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [processing, setProcessing] = useState(false);

  const rankLabels = ["🏆 BEST", "🥈 2ND BEST", "🥉 3RD BEST"];
  const colors = [
    "#28a745",
    "#007bff",
    "#fd7e14",
    "#6f42c1",
    "#e83e8c",
    "#20c997",
  ];

  const monday = mondaySdk();

  const LOCAL_TEST = process.env.REACT_APP_LOCAL_TEST === "true";
  const LOCAL_ITEM_ID = Number(process.env.REACT_APP_LOCAL_ITEM_ID);

  useEffect(() => {
    if (LOCAL_TEST && !isNaN(LOCAL_ITEM_ID) && LOCAL_ITEM_ID) {
      console.log("[Local Test] Item ID:", LOCAL_ITEM_ID);
      setItemId(LOCAL_ITEM_ID);
      fetchOrderWithLineItems(LOCAL_ITEM_ID);
      return;
    }

    monday.get("context").then((res) => {
      const context = res.data as any;
      if (context && "boardId" in context && "itemId" in context) {
        const id = Number(context.itemId);
        console.log("Board ID:", Number(context.boardId));
        console.log("Item ID:", id);
        setItemId(id);
        fetchOrderWithLineItems(id);
      } else {
        console.warn("Board ID or Item ID not available in this context:", context);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!lineItems || lineItems.length === 0) return;

    const alreadyRanked = lineItems.some((li) =>
      li.suppliers?.some((s) => s.rankText)
    );
    if (alreadyRanked) return;

    console.log("Ranking suppliers...");

    const ranked = lineItems.map((li) => {
      if (!li.suppliers || li.suppliers.length === 0) return li;

      const rankedSuppliers = li.suppliers.map((s, index) => ({
        ...s,
        rankText: index < 3 ? rankLabels[index] : `${index + 1}TH BEST`,
        color: colors[index] || "#6c757d",
      }));

      return { ...li, suppliers: rankedSuppliers, availableCouriers: li.availableCouriers };
    });

    setLineItems(ranked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems]);

  const totalQuantity: number = lineItems.reduce(
    (sum, item) => sum + Number(item.quantity),
    0
  );
  const totalAmount: number = lineItems.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.unitPrice),
    0
  );

  const fetchOrderWithLineItems = async (id: number) => {
    try {
      setLoading(true);
      const res = await fetch(`/api/order?itemId=${id}`);
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned non-JSON response: ${text.slice(0, 100)}`);
      }
      if (!res.ok) throw new Error(data?.error || data?.stack || `Server error: ${res.status}`);
      if (!data || !data.order) throw new Error("Invalid response from server");
      console.log("orderDetails--->", data);
      setOrder(data.order);
      setLineItems(data.lineitems);
      setCustomerData(data.customer);
    } catch (err) {
      console.error("Error fetching data:", err);
      toast.error(err instanceof Error ? err.message : "Failed to load order");
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    console.log("inside this handleclick");
    const hasValidItem = lineItems.some(
      (item) =>
        item.supplierId &&
        item.courierId &&
        item.status !== "Manifest Generated"
    );

    console.log("hasValidItem-->", hasValidItem);

    if (!hasValidItem) {
      toast.error(
        "Please select supplier and courier for at least one order line item."
      );
      return;
    }
    setDialogOpen(true);
  };

  const handleSupplierChange = async (itemId: string, supplierId: string) => {
    if (!supplierId) {
      setLineItems((prev) =>
        prev.map((li) => li.id === itemId ? { ...li, supplierId: "", courierId: "", availableCouriers: [] } : li)
      );
      return;
    }
    setLineItems((prev) =>
      prev.map((li) => (li.id === itemId ? { ...li, supplierId } : li))
    );

    if (!customer_info) return;
    const item = lineItems.find((li) => li.id === itemId);
    const supplier = item?.suppliers.find((s) => s.supplier_id === supplierId);
    console.log("[handleSupplierChange] item:", item);
    console.log("[handleSupplierChange] supplier:", supplier); 
    if (!supplier) return;

    const payload = {
      supplier_postalcode: supplier.postal_code,
      customer_postalcode: customer_info.postal_code,
      weight: supplier.weight,
      cod: 1,
    };
    console.log("[handleSupplierChange] supplier:", supplier);
    console.log("[handleSupplierChange] payload:", payload);

    try {
      const res = await fetch(`/api/get-couriers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      console.log("courer_data--->", data);

      const couriers =
        data.couriers?.data?.available_courier_companies?.map(
          (c: CourierCompany) => ({
            courier_id: c.courier_company_id,
            courier_name: c.courier_name,
            estimated_delivery_days: c.estimated_delivery_days,
            rating: c.rating,
            freight_charge: c.freight_charge,
          })
        ) || [];

      console.log("couriers--->", couriers);

      if (!couriers.length) {
        toast.error("No couriers available for this supplier and destination.");
        return;
      }

      const sortedCouriers = await fetch(`/api/sort_couriers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ couriers }),
      });
      const sortdata = await sortedCouriers.json();
      console.log("sortdata--->", sortdata);

      const sortCouriers: Courier[] = sortdata.couriers || [];
      console.log("sortCouriers", sortCouriers);

      if (!sortCouriers.length) {
        toast.error("No couriers available for this route.");
        return;
      }

      const rankedCouriers = sortCouriers.map(
        (courier: Courier, index: number) => {
          const rankText = index < 3 ? rankLabels[index] : `${index + 1}TH BEST`;
          return {
            ...courier,
            rankText,
            color: colors[index] || "#6c757d",
            backgroundColor:
              index === 0
                ? "#f8fff8"
                : index === 1
                ? "#f0f8ff"
                : index === 2
                ? "#fff8f0"
                : "transparent",
          };
        }
      );
      setLineItems((prev) =>
        prev.map((li) =>
          li.id === itemId ? { ...li, availableCouriers: rankedCouriers } : li
        )
      );
    } catch (err) {
      console.error("Error fetching couriers:", err);
    }
  };

  const handleCourierChange = (itemId: string, courierId: string) => {
    setLineItems((prev) =>
      prev.map((li) => (li.id === itemId ? { ...li, courierId } : li))
    );
  };

  const groupLineItemsForManifest = (items: LineItem[]): GroupedManifests[] => {
    const groups: Record<string, GroupedManifests> = {};

    items.forEach((item) => {
      if (!item.supplierId || !item.courierId || !item.availableCouriers?.length) return;

      const key = `${item.supplierId}_${item.courierId}`;
      if (!groups[key]) {
        groups[key] = {
          key,
          supplierId: item.supplierId,
          courierId: item.courierId,
          items: [],
        };
      }
      groups[key].items.push(item);
    });

    return Object.values(groups);
  };

  const handleGenerateManifestAndLabel = async () => {
    if (!lineItems.length || !customer_info) return;

    try {
      const pendingItems = lineItems.filter(
        (item) => item.status !== "Manifest Generated"
      );

      if (!pendingItems.length) {
        console.log("All manifests are already generated!");
        return;
      }
      const manifests = groupLineItemsForManifest(pendingItems);

      for (const manifest of manifests) {
        const normalizedSupplierId = Array.isArray(manifest.supplierId)
          ? manifest.supplierId[0]
          : manifest.supplierId;

        console.log("normalizedSupplierId:", normalizedSupplierId);
        console.log("available supplier_ids:", manifest.items[0]?.suppliers.map((s) => s.supplier_id));

        const supplier = manifest.items[0]?.suppliers.find((s) => {
          const sid = Array.isArray(s.supplier_id) ? s.supplier_id[0] : s.supplier_id;
          return String(sid) === String(normalizedSupplierId);
        });
        console.log("supplier8787---->", supplier);

        const courier = manifest.items[0]?.availableCouriers?.find(
          (c) => String(c.courier_id) === String(manifest.courierId)
        );
        console.log("courier8787---->", courier);

        if (!supplier) {
          toast.error("Could not find supplier details. Please re-select the supplier.");
          return;
        }
        if (!courier) {
          toast.error("Could not find courier details. Please re-select the courier.");
          return;
        }

        const manifestPayload = {
          supplierId: normalizedSupplierId,
          supplierName: supplier?.supplier_name || "",
          supplierAddress: supplier?.supplier_address || "",
          supplierPhone: supplier?.supplier_phone || "",
          courierId: manifest.courierId,
          courierName: courier?.courier_name || "",
          orderId: order?.id || null,
          customer: customer_info,
          lineitems: manifest.items,
        };

        console.log("manifestPayload---->", manifestPayload);

        const manifestResponse = await fetch(`/api/generate-manifest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(manifestPayload),
        });
        if (!manifestResponse.ok) {
          const errData = await manifestResponse.json().catch(() => ({}));
          throw new Error(`Manifest generation failed: ${errData.error || manifestResponse.status}`);
        }

        const labelResponse = await fetch(`/api/generate-label`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(manifestPayload),
        });
        if (!labelResponse.ok) {
          throw new Error(`Label generation failed: ${labelResponse.status}`);
        }
      }

      toast.success("Manifests and Labels generated successfully!");
    } catch (error) {
      console.error("Error generating manifest/label:", error);
      toast.error("Failed to generate manifest/label");
    }
  };

  const handleConfirm = async () => {
    setDialogOpen(false);
    setProcessing(true);
    try {
      setButtonLoading(true);
      await handleGenerateManifestAndLabel();
    } finally {
      setButtonLoading(false);
      setProcessing(false);
    }
    await fetchOrderWithLineItems(itemId!);
  };

  const allGenerated = lineItems.every(
    (item) => item.status === "Manifest Generated"
  );

  return (
    <div className="relative">
      <div>
        <Toaster position="top-right" reverseOrder={true} />
      </div>

      {loading && (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-gray-200 bg-opacity-70 z-[9999]">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600 mb-4"></div>
          <p className="text-black font-medium text-lg">
            Please wait, loading your data...
          </p>
        </div>
      )}

      {processing && (
        <div className="fixed inset-0 flex flex-col items-center justify-center bg-transparent backdrop-blur-[1px] z-[9999] pointer-events-auto">
          <div className="absolute inset-0 bg-white/30 backdrop-blur-sm pointer-events-none"></div>
          <div className="relative flex flex-col items-center justify-center space-y-3">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600"></div>
            <p className="text-gray-800 font-medium text-lg drop-shadow-sm">
              Generating Manifest & Label, please wait...
            </p>
          </div>
        </div>
      )}

      {!loading && (
        <div className="p-6 grid gap-6 max-w-6xl mx-auto">
          {order && (
            <Card className="shadow-lg rounded-2xl border-2 border-gray-300">
              <CardHeader className="border-b-2 border-gray-200">
                <CardTitle className="text-xl font-bold flex justify-between items-center">
                  Order #{order.name}
                  <span className="text-sm font-medium text-gray-600"></span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm pt-4">
                <p className="flex gap-2">
                  <span className="font-semibold text-gray-700">Date:</span>
                  <span className="text-gray-800">{order.date}</span>
                </p>
                <p className="flex gap-2">
                  <span className="font-semibold text-gray-700">Total Order Value:</span>
                  <span className="text-gray-800 font-medium">${order.totalPrice}</span>
                </p>
                <p className="flex gap-2">
                  <span className="font-semibold text-gray-700">Description:</span>
                  <span className="text-gray-800">{order.description}</span>
                </p>
                <p className="flex gap-2">
                  <span className="font-semibold text-gray-700">Customer Postal Code:</span>
                  <span className="text-gray-800">{order.customerPostalCode}</span>
                </p>
              </CardContent>
            </Card>
          )}

          {customer_info && (
            <Card className="shadow-lg rounded-2xl border-2 border-gray-300">
              <CardHeader className="border-b-2 border-gray-200">
                <CardTitle className="text-lg font-semibold">
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm pt-4">
                <p className="flex gap-2">
                  <span className="font-semibold text-gray-700">Name:</span>
                  <span className="text-gray-800">{customer_info.name}</span>
                </p>
                <p className="flex gap-2">
                  <span className="font-semibold text-gray-700">Email:</span>
                  <a href={`mailto:${customer_info.email}`} className="text-blue-600 hover:underline">
                    {customer_info.email}
                  </a>
                </p>
                <p className="flex gap-2">
                  <span className="font-semibold text-gray-700">Phone:</span>
                  <span className="text-gray-800">{customer_info.phone}</span>
                </p>
                <p className="flex gap-2">
                  <span className="font-semibold text-gray-700">Address:</span>
                  <span className="text-gray-800">{customer_info.address}</span>
                </p>
              </CardContent>
            </Card>
          )}

          {lineItems.length > 0 && (
            <Card className="shadow-lg rounded-2xl border-2 border-gray-300">
              <CardHeader className="border-b-2 border-gray-200">
                <CardTitle className="text-xl font-semibold">Products</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="overflow-x-auto border-2 border-gray-300 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 border-b-2 border-gray-300">
                      <tr>
                        <th className="text-left py-3 px-4 font-semibold border-r border-gray-300">Product</th>
                        <th className="text-center py-3 px-4 font-semibold border-r border-gray-300">SKU</th>
                        <th className="text-center py-3 px-4 font-semibold border-r border-gray-300">Qty</th>
                        <th className="text-center py-3 px-4 font-semibold border-r border-gray-300">Unit Price</th>
                        <th className="text-center py-3 px-4 font-semibold border-r border-gray-300">Total Price</th>
                        <th className="text-center py-3 px-4 font-semibold border-r border-gray-300">Supplier</th>
                        <th className="text-center py-3 px-4 font-semibold border-r border-gray-300">Courier</th>
                        <th className="text-center py-3 px-4 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item, index) => (
                        <tr
                          key={item.id}
                          className={`${index !== lineItems.length - 1 ? "border-b border-gray-200" : ""} hover:bg-gray-50`}
                        >
                          <td className="py-3 px-4 border-r border-gray-200">{item.product}</td>
                          <td className="py-3 px-4 text-center border-r border-gray-200">{item.sku}</td>
                          <td className="py-3 px-4 text-center border-r border-gray-200">{item.quantity}</td>
                          <td className="py-3 px-4 text-center border-r border-gray-200">${item.unitPrice}</td>
                          <td className="py-3 px-4 text-center border-r border-gray-200">${(Number(item.quantity) * Number(item.unitPrice)).toFixed(2)}</td>
                          <td className="py-3 px-4 border-r border-gray-200">
                            {item.status === "Manifest Generated" ? (
                              <span className="text-gray-700 block text-center">
                                {item.suppliers.find((s) => s.supplier_id === item.supplierId)?.supplier_name ||
                                  item.supplierName ||
                                  "—"}
                              </span>
                            ) : (
                              <Select
                                isClearable
                                value={item.suppliers.find((s) => s.supplier_id === item.supplierId) || null}
                                onChange={(option) => handleSupplierChange(item.id, option?.supplier_id || "")}
                                options={item.suppliers}
                                getOptionLabel={(option) => `${option.supplier_name} — ${option.rankText || ""}`}
                                getOptionValue={(option) => option.supplier_id}
                                placeholder={item.suppliers.length ? "Select supplier" : "No suppliers available"}
                                isSearchable
                                menuPortalTarget={document.body}
                                styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
                              />
                            )}
                          </td>
                          <td className="py-3 px-4 border-r border-gray-200">
                            {item.status === "Manifest Generated" ? (
                              <span className="text-gray-700 block text-center">
                                {item.courierName || "—"}
                              </span>
                            ) : (
                              <Select
                                value={item.availableCouriers?.find(
                                  (c) => String(c.courier_id) === String(item.courierId) || c.courier_name === item.courierName
                                ) || null}
                                onChange={(option) => handleCourierChange(item.id, option?.courier_id || "")}
                                options={item.availableCouriers || []}
                                getOptionLabel={(option) => `${option.courier_name} — ${option.rankText}`}
                                getOptionValue={(option) => option.courier_id}
                                placeholder={item.availableCouriers?.length ? "Select courier" : "No couriers available"}
                                isSearchable
                                menuPortalTarget={document.body}
                                styles={{ menuPortal: (base) => ({ ...base, zIndex: 9999 }) }}
                              />
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="text-green-600 font-medium text-xs">{item.status}</span>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-gray-300 bg-gray-100 font-semibold">
                        <td className="py-3 px-4 text-right border-r border-gray-300" colSpan={2}>Totals:</td>
                        <td className="py-3 px-4 text-center border-r border-gray-300">{totalQuantity}</td>
                        <td className="py-3 px-4 text-center border-r border-gray-300" colSpan={2}>${totalAmount.toFixed(2)}</td>
                        <td colSpan={3}></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {!loading && (
            <div className="flex justify-end">
              <Button
                className="bg-green-600 hover:bg-green-700 text-white relative"
                onClick={handleClick}
                disabled={buttonLoading || allGenerated}
              >
                {buttonLoading ? (
                  <Loader2 className="animate-spin h-5 w-5 absolute inset-0 m-auto" />
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Generate Manifest & Label
                  </>
                )}
              </Button>
              <ConfirmDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                title="Generate Manifest & Label"
                description="Are you sure you want to generate the manifest and label for this order?"
                confirmText="Yes, Generate"
                cancelText="Cancel"
                confirmColor="green"
                onConfirm={handleConfirm}
                loading={buttonLoading}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
