import { connection } from "next/server";
import { HotelAdminRoomsPage } from "@/components/admin/hotel-admin-rooms-page";

export default async function AdminRoomsPage() {
  await connection();
  return <HotelAdminRoomsPage />;
}
