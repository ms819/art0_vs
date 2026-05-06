import React from 'react';
import { useNavigate } from 'react-router-dom';

function About() {
  const navigate = useNavigate();

  // 赤デッキの画像ファイル名
  const deckImages = [
    'suthiraho-nn.jpeg', 'suthiraho-nn.jpeg', 
    'doraguron.jpeg', 'doraguron.jpeg', 'doraguron.jpeg',
    'rizadoejji.jpeg', 'rizadoejji.jpeg', 'rizadoejji.jpeg',
    'rokukeratopsu.jpeg', 'rokukeratopsu.jpeg', 'rokukeratopsu.jpeg',
    'raimei-ryu-zi-gurimu.webp', 'raimei-ryu-zi-gurimu.webp', 'raimei-ryu-zi-gurimu.webp',
    'art_j.jpeg','art_j.jpeg','art_j.jpeg',
    
  ];

  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1 style={{ textAlign: 'left' }}>赤デッキ</h1>

      {/* カード画像をグリッドで表示 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: '10px',
          justifyItems: 'center',
          marginTop: '20px'
        }}
      >
        {deckImages.map((img, idx) => (
          <img
            key={idx}
            src={`/images/${img}`}
            alt={`card-${idx}`}
            style={{ width: '120px', height: 'auto' }}
          />
        ))}
      </div>

      {/* 右下に戻るボタン */}
      <div style={{ textAlign: 'right', marginTop: '20px' }}>
        <button onClick={() => navigate('/')}>戻る</button>
      </div>
    </div>
  );
}

export default About;