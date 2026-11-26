'use client';

// Copy into your React/Next.js host. Install/link @cat-defense/sdk or adjust this import
// to the portable folder's sdk/index.js. The game itself has no React dependency.
import {useEffect, useRef, type CSSProperties} from 'react';
import {createCatDefenseClient, type CatDefenseClient, type InitOptions} from '@cat-defense/sdk';

type Props = InitOptions & {
  gameUrl: string;
  className?: string;
  style?: CSSProperties;
  onReady?: (game: CatDefenseClient) => void | Promise<void>;
  onEvent?: (type: string, payload: unknown) => void;
  onError?: (error: Error) => void;
};

export function CatDefenseFrame(props: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const clientRef = useRef<CatDefenseClient | null>(null);

  useEffect(() => {
    if (!iframeRef.current) return;
    let active = true;
    let generation = 0;
    const client = createCatDefenseClient({iframe:iframeRef.current, gameUrl:props.gameUrl});
    clientRef.current = client;
    const report = (error: unknown) => {
      if (active) latest.current.onError?.(error instanceof Error ? error : new Error(String(error)));
    };
    const stopEvents = client.on('*', (payload,type) => latest.current.onEvent?.(type,payload));
    const stopReady = client.on('ready', async () => {
      const current = ++generation;
      try {
        const {player,rules,catId,runId} = latest.current;
        await client.init({...(player ? {player}:{}), ...(rules ? {rules}:{}), ...(catId ? {catId}:{}), ...(runId !== undefined ? {runId}:{})});
        if (active && current === generation) await latest.current.onReady?.(client);
      } catch (error) {if (current === generation) report(error);}
    });
    client.ready().catch(report);
    return () => {active=false;generation++;stopEvents();stopReady();client.destroy();if(clientRef.current===client)clientRef.current=null;};
  }, [props.gameUrl]);

  // New prop values configure the existing game; they do not recreate the iframe.
  useEffect(() => {
    const client=clientRef.current;
    if (!client?.connected) return;
    let active=true;
    const {player,rules,catId,runId}=props;
    client.init({...(player ? {player}:{}),...(rules ? {rules}:{}),...(catId ? {catId}:{}),...(runId !== undefined ? {runId}:{})})
      .catch(error=>{if(active)latest.current.onError?.(error);});
    return ()=>{active=false;};
  }, [props.player, props.rules, props.catId, props.runId]);

  return <iframe ref={iframeRef} title="Cat Defense" className={props.className}
    allow="autoplay" sandbox="allow-scripts allow-same-origin"
    style={{width:'100%',aspectRatio:'16 / 10',border:0,...props.style}}/>;
}
