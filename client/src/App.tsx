import {LoadingScreen} from "@/components/loading-screen";
import {Component,lazy,Suspense,useEffect} from "react";
import {BrowserRouter,Routes,Route,Navigate,useLocation,Outlet} from "react-router-dom";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {AuthPage} from "@/pages/auth";
import {useMe} from "@/hooks/use-auth";
import {setUnauthorizedHandler} from "@/lib/api";
const ProductInformationPage=lazy(()=>import("@/pages/product-information").then(m=>({default:m.ProductInformationPage})));
const AccountRecoveryPage=lazy(()=>import("@/components/account-security").then(m=>({default:m.AccountRecoveryPage})));
const LandingPage=lazy(()=>import("@/marketing/LandingPage").then(m=>({default:m.LandingPage})));
const AppShell=lazy(()=>import("@/components/layout/app-shell").then(m=>({default:m.AppShell})));
const DashboardPage=lazy(()=>import("@/pages/dashboard").then(m=>({default:m.DashboardPage})));
const LeadsPage=lazy(()=>import("@/pages/leads").then(m=>({default:m.LeadsPage})));
const ImportsPage=lazy(()=>import("@/pages/imports").then(m=>({default:m.ImportsPage})));
const LeadDetailPage=lazy(()=>import("@/pages/lead-detail").then(m=>({default:m.LeadDetailPage})));
const IntelligencePage=lazy(()=>import("@/pages/intelligence").then(m=>({default:m.IntelligencePage})));
const OutboundPage=lazy(()=>import("@/pages/outbound").then(m=>({default:m.OutboundPage})));
const ConversationsPage=lazy(()=>import("@/pages/conversations").then(m=>({default:m.ConversationsPage})));
const WorkflowsPage=lazy(()=>import("@/pages/workflows").then(m=>({default:m.WorkflowsPage})));
const EventRecoveryPage=lazy(()=>import("@/pages/event-recovery").then(m=>({default:m.EventRecoveryPage})));
const ActivityPage=lazy(()=>import("@/pages/activity").then(m=>({default:m.ActivityPage})));
const DeveloperToolsPage=lazy(()=>import("@/pages/developer-tools").then(m=>({default:m.DeveloperToolsPage})));
const SettingsPage=lazy(()=>import("@/pages/settings").then(m=>({default:m.SettingsPage})));
const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:30000,retry:1}}});
const loading=<LoadingScreen/>;
export default function App(){return <QueryClientProvider client={queryClient}><BrowserRouter><Suspense fallback={loading}><Routes>
 <Route path="/product-information" element={<ProductInformationPage/>}/><Route path="/recover" element={<AccountRecoveryPage/>}/><Route path="/" element={<PublicBoundary><Suspense fallback={<LoadingScreen/>}><LandingPage/></Suspense></PublicBoundary>}/><Route path="/login" element={<AuthRoute mode="login"/>}/><Route path="/register" element={<AuthRoute mode="register"/>}/>
 <Route element={<AuthGate/>}><Route path="developer-tools" element={<DeveloperToolsPage/>}/><Route element={<AppShell/>}>
  <Route path="app" element={<DashboardPage/>}/><Route path="leads" element={<LeadsPage/>}/><Route path="leads/:id" element={<LeadDetailPage/>}/><Route path="imports" element={<ImportsPage/>}/><Route path="imports/:id" element={<ImportsPage/>}/><Route path="intelligence" element={<IntelligencePage/>}/><Route path="outbound" element={<OutboundPage/>}/><Route path="conversations" element={<ConversationsPage/>}/><Route path="workflows" element={<WorkflowsPage/>}/><Route path="event-recovery" element={<EventRecoveryPage/>}/><Route path="activity" element={<ActivityPage/>}/><Route path="settings" element={<SettingsPage/>}/>
 </Route></Route><Route path="*" element={<main className="p-12"><h1>Page not found</h1><a href="/">Product home</a> / <a href="/app">Open workspace</a></main>}/>
 </Routes></Suspense></BrowserRouter></QueryClientProvider>;}
function useSessionBoundary(){const query=useMe();useEffect(()=>{setUnauthorizedHandler(()=>{queryClient.removeQueries({predicate:query=>query.queryKey[0]!=="auth"});queryClient.setQueryData(["auth","me"],null);});},[]);return query;}
function AuthGate(){const {data:me,isLoading}=useSessionBoundary(),location=useLocation();if(isLoading)return loading;if(!me)return <Navigate replace to={"/login?returnTo="+encodeURIComponent(location.pathname+location.search+location.hash)}/>;return <Outlet/>;}
function safeReturn(value:string|null){if(!value)return "/app";try{const url=new URL(value,window.location.origin);if(url.origin===window.location.origin&&/^\/(app|leads|imports|intelligence|outbound|conversations|workflows|event-recovery|activity|settings|developer-tools)(\/|$)/.test(url.pathname))return url.pathname+url.search+url.hash;}catch{}return "/app";}
function AuthRoute({mode}:{mode:"login"|"register"}){const {data:me,isLoading}=useSessionBoundary(),location=useLocation();if(isLoading)return loading;if(me)return <Navigate replace to={safeReturn(new URLSearchParams(location.search).get("returnTo"))}/>;return <AuthPage key={mode} initialMode={mode}/>;}

function PublicFallback(){return <main className="mx-auto max-w-5xl px-6 py-16"><p>AI Lead Intelligence &amp; Outbound Automation</p><h1 className="my-6 text-5xl font-semibold">Your next move, backed by what you know.</h1><p>Turn existing enquiries into explained priorities and reviewed actions. Product preview; examples use synthetic data.</p><nav className="mt-8 flex gap-5"><a href="/" className="underline">Reload page</a><a href="/login" className="underline">Sign in</a><a href="/register" className="underline">Get started</a></nav></main>;}
class PublicBoundary extends Component<{children:React.ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true};}render(){return this.state.failed?<PublicFallback/>:this.props.children;}}
