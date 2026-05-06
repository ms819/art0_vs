import { Navigate, Route, Routes } from "react-router-dom";
import { BattlePage } from "./pages/BattlePage";
import { CreateRoomPage } from "./pages/CreateRoomPage";
import { HomePage } from "./pages/HomePage";
import { ResultPage } from "./pages/ResultPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/create" element={<CreateRoomPage />} />
      <Route path="/battle/:roomId" element={<BattlePage />} />
      <Route path="/result" element={<ResultPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
