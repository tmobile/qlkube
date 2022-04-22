import React from 'react';
import './fancyInput.css';

function FancyInput({setPreSearchString}) {
  return (
    <div className="group" style={{flex:2}}>
      <input style={{backgroundColor:'transparent', color:'white', fontFamily:'monospace'}} type="text" required onChange={(txt) => setPreSearchString(txt.target.value)}/>
        <span className="highlight"></span>
        <span className="bar"></span>
        <label className='labelMod'>Cluster Url</label>
    </div>
  );
}

export default FancyInput;
