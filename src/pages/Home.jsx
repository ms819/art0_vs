import React from 'react';
import { useNavigate } from 'react-router-dom';

function Home() {
  const navigate = useNavigate();

  return (
    <div>
      <h1>ようこそ！</h1>

      <button onClick={() => navigate('/battle')}>
        対戦する
      </button>

      <button onClick={() => navigate('/about')}>
        デッキを確認する
      </button>

      <hr />

      
    </div>
  );
}

export default Home;