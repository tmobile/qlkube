import React, { useState, useRef } from 'react';
import GraphiQL from 'graphiql';
import FancyInput from './components/fancyInput';

import QlkubeProvider from './qlkube-client/react/context/QlkubeProvider';
import { useMonoSub, useLink } from './qlkube-client/react/hooks/qlkubeHooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {  faCaretDown, faWarning } from '@fortawesome/free-solid-svg-icons'

import './App.css';
import 'graphiql/graphiql.min.css';

var axios = require('axios');

const isDev= true;
const devUrlIntrospection= 'http://localhost:8080/explorecheck';
const qlkubeQueryUrl = "http://localhost:8080/gql"
const qlkubeSubscriptionUrl = "ws://localhost:8080/gql";

const App = ({}) => {

  const getUrl = (queryMethod) => {
    let replacedUrl;
    let currentUrl =  window.location.href;
  
      if(isDev){
        if(queryMethod === 'sub'){
          replacedUrl = qlkubeSubscriptionUrl;
        }else{
          replacedUrl = qlkubeQueryUrl;
        }
      }else{
        let tempReplacedUrl = currentUrl.replace("explore", "gql");
        if(queryMethod === 'sub'){
          if(tempReplacedUrl.includes('https'))replacedUrl = tempReplacedUrl.replace("https", "wss");
          else if(tempReplacedUrl.includes('http'))replacedUrl = tempReplacedUrl.replace("http", "ws");
        }else {
          replacedUrl = tempReplacedUrl;
        }
      }
    return replacedUrl;
  }
  
  return (
    <QlkubeProvider
      wsUrl={getUrl('sub')}
      queryUrl={getUrl('query')}
    >
      <Main/>
    </QlkubeProvider>
  )
}

const Main = () => {

  const { socketState } = useLink();

  const [hasIntrospection, setHasIntrospection]= useState(false);
  const [preSearchString, setPreSearchString]= useState('')
  const [searchString, setSearchString]= useState('');
  const [typeCount, setTypeCount]= useState(0);

  return (
    <div
      style={{
        maxHeight:'100vh',
        minHeight:'100%',
        width:'100%',
        overflow:'hidden',
        position:'relative'
      }}
    >
      {
        searchString?.includes('http')&&hasIntrospection?
        <MemoExplorer
          searchString={searchString}
          setTypeCount={setTypeCount}
          setHasIntrospection={setHasIntrospection}
        />:
        <div
          style={{
            minHeight:'100vh',
            width:'100%',
            justifyContent:'center',
            alignItems:'center',
            display:'flex',
            backgroundColor:'white',
            fontSize:30,
            fontWeight:'bold',
            fontFamily:'Verdana, Geneva, Tahoma, sans-serif'
          }}
        >
          <FontAwesomeIcon icon={faWarning} size={'1x'} color={'#ffce47'} style={{marginRight:25}}/>
          Input Cluster Url
        </div>
      }

      <UtilityPanel
        setPreSearchString={setPreSearchString}
        preSearchString={preSearchString}
        setSearchString={setSearchString}
        typeCount={typeCount}
        setHasIntrospection={setHasIntrospection}
        typeCount={typeCount}
        hasIntrospection={hasIntrospection}
        socketState={socketState}
      />
    </div>
  );
}

const Explorer = ({ searchString, setTypeCount, setHasIntrospection }) => {

  const { monoSub } = useMonoSub();

  const getUrl = (queryMethod) => {
    let replacedUrl;
    let currentUrl =  window.location.href;
  
    if(queryMethod==='introspection'){
      if(isDev){
        replacedUrl = devUrlIntrospection;
      }else{
        replacedUrl = currentUrl.replace("explore", "explorecheck");
      }
    }
    return replacedUrl;
  }
  
  return (
    <div
      style={{
        height:'100vh'
      }}
    >
      <GraphiQL
        fetcher={async graphQLParams => {
          const { query, operationName, variables } = graphQLParams;
          const queryMethod = query.slice(0, 5);

          if(
            queryMethod === 'query'||
            queryMethod === 'mutat'
          ){
            const authToken = variables?.['authorization'];
            delete variables['authorization'];

            const queryRes = await monoSub(
              authToken,
              searchString,
              query,
              variables,
              (status) => ''
            );

            return queryRes
          }
          else if(queryMethod === 'subsc'){} // # Add Subscriptions
          else if(operationName === 'IntrospectionQuery'){ // introspection
            const introspectionUrl = getUrl('introspection');
            var config = {
              method: 'post',
              url: introspectionUrl,
              headers: {clusterUrl: searchString}
            };
            
            const response = await axios(config)
            const { data } = response;

            if(data?.data?.error){
              setTypeCount(0);
              setHasIntrospection(false);
            }else{
              setHasIntrospection(true);
              const typeCount = data?.data?.__schema?.types?.length || 0
              setTypeCount(typeCount);
              return data;
            }
          }
        }}
      />
     </div>
  );
}

const ConnectingSplash = () => {
  return (
    <div
      style={{
        height:'100vh',
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'white'
      }}
    >
      <div
        style={{
          fontSize: 20,
          fontWeight: 'bold',
          fontFamily: 'Verdana, Geneva, Tahoma, sans-serif',
          color: 'black',
        }}
      >
        Connecting...
      </div>
    </div>
  )

}

const UtilityPanel = ({
  setPreSearchString,
  preSearchString,
  setSearchString,
  typeCount,
  setHasIntrospection,
  hasIntrospection,
  socketState
}) => {

  const utilRef = useRef();
  const caretRef = useRef();

  const onToggleMenu = () => {
    const util = utilRef.current;
    util.classList.toggle('util2');
    const util2 = caretRef.current;
    util2.classList.toggle('cUp')
  }

  return (
    <div
      style={{
        height: 70,
        width: '100%',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 14,
        paddingRight: 14,
        paddingBottom: 14,
        position: 'absolute',
        backgroundColor: 'black',
        zIndex: 10
      }}
      ref={utilRef}
      className={'util'}
    >
      <div
        style={{
          width: '100%',
          height: 10,
          position: 'absolute',
          top: 0,
          display: 'flex',
          justifyContent: 'center'
        }}
      >
        <button
          style={{
            height: 30,
            width: 30,
            borderRadius: 25,
            backgroundColor: 'black',
            alignSelf: 'center',
            transform: `translate(0px, -30px)`,
            justifyContent: 'center',
            alignItems: 'center',
            display: 'flex',
            borderColor: 'black'
          }}
          onClick={() => onToggleMenu()}
        >
          {
            <div
              ref={caretRef}
              className={'cDown'}
            >
              <FontAwesomeIcon icon={faCaretDown} size={'2x'} color={'white'} />
            </div>
          }
        </button>
      </div>
      <div
        style={{
          flex: 8,
          justifyContent: 'flex-start',
          alignItems: 'flex-start',
          display: 'flex',
          fontSize: 15,
          fontWeight: 'bold',
          fontFamily: 'Verdana, Geneva, Tahoma, sans-serif',
          color: 'white',
          paddingLeft: 22
        }}
      >
        QLKUBE EXPLORER
      </div>
      <div
        style={{
          display:'flex',
          flexDirection:'row',
          justifyContent:'center',
          alignItems:'center'
        }}
      >
        <FancyInput
          setPreSearchString={setPreSearchString}
        />
      </div>

      <button
        style={{
          width: 100,
          height: '50%',
          marginRight: 20,
          marginLeft: 20,
          fontFamily: 'Verdana, Geneva, Tahoma, sans-serif',
          backgroundColor: 'white',
          borderWidth: 0,
          borderRadius: 7
        }}
        onClick={() => {
          if(preSearchString.includes('http')){
            setHasIntrospection(true)
            setSearchString(preSearchString)
          }
        }}
      >
        Search
      </button>
      <div
        style={{
          display:'flex',
          flexDirection:'row',
          color:'silver',
          fontFamily: 'Verdana, Geneva, Tahoma, sans-serif',
          fontSize:13,
          position:'absolute',
          top:7,
          right:35,
          justifyContent:'center',
          alignItems:'center',
          fontWeight:'bold'
        }}
      >
          <div
            style={{
              height:12,
              width:12,
              borderRadius:20,
              backgroundColor: (hasIntrospection&&socketState) ? '#7BE700' : '#FA330D',
              marginRight:10
            }}
          />
           {(hasIntrospection&&socketState)? 'connected' : 'disconnected'}

        </div>
      {
        typeCount > 0 &&
        <div
          style={{
            position: 'absolute',
            bottom: 6,
            right: 35,
            color: 'silver',
            fontFamily: 'Verdana, Geneva, Tahoma, sans-serif',
            fontSize: 13
          }}
        >
          Type volume: <span style={{fontWeight:'bold', color:'orange'}}>{typeCount}</span>
        </div>
      }
    </div>
  )
}

const MemoExplorer = React.memo(Explorer);
export default App;