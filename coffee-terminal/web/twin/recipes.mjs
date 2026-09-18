// Resource names are stable experiment inputs. Device processing releases the robot.
export function latteTasks(world) {
  const tasks=[];
  const add=(id,type,after,details)=>tasks.push({id,type,after,resources:[],...details});
  const move=(id,robot,station,after,object)=>add(id,'move',after,{robot,station,allowedGrasps:object?[{robot,object}]:[]});
  const grasp=(id,robot,object,after)=>add(id,'grasp',after,{robot,object});
  const release=(id,robot,object,station,after)=>add(id,'release',after,{robot,object,station});
  move('left-get-cup','left','cups',[],'cup');
  grasp('left-grasp','left','cup',['left-get-cup']);
  move('left-to-brew','left','brew',['left-grasp']);
  release('left-release-brew','left','cup','brew',['left-to-brew']);
  move('left-retreat','left','left-ready',['left-release-brew'],'cup');
  add('extract','process',['left-retreat'],{device:'brewer',object:'cup'});
  add('foam','process',[],{device:'foamer',object:'milk-cup'});
  move('right-ready','right','right-ready',[]);
  move('right-get-milk','right','milk',['foam','right-ready'],'milk-cup');
  grasp('right-grasp-milk','right','milk-cup',['right-get-milk']);
  move('left-get-coffee','left','brew',['extract'],'cup');
  grasp('left-grasp-coffee','left','cup',['left-get-coffee']);
  move('left-to-handoff','left','handoff',['left-grasp-coffee']);
  release('left-release-handoff','left','cup','handoff',['left-to-handoff']);
  move('left-clear-handoff','left','left-ready',['left-release-handoff'],'cup');
  move('right-to-pour','right','pour',['right-grasp-milk','left-clear-handoff']);
  add('pour','transfer',['right-to-pour'],{robot:'right',source:'milk-cup',object:'cup',duration:6,resources:['zone:handoff']});
  move('right-return-pitcher','right','milk',['pour']);
  release('right-release-pitcher','right','milk-cup','milk',['right-return-pitcher']);
  move('right-clear-pitcher','right','right-ready',['right-release-pitcher'],'milk-cup');
  move('right-get-cup','right','handoff',['right-clear-pitcher'],'cup');
  grasp('right-grasp-cup','right','cup',['right-get-cup']);
  let serveAfter='right-grasp-cup';
  if(world?.devices.lidder) {
    move('right-to-lid','right','lid',[serveAfter]);
    release('right-release-lid','right','cup','lid',['right-to-lid']);
    move('right-clear-lid','right','right-ready',['right-release-lid'],'cup');
    add('seal','process',['right-clear-lid'],{device:'lidder',object:'cup'});
    move('right-get-sealed','right','lid',['seal'],'cup');
    grasp('right-grasp-sealed','right','cup',['right-get-sealed']);
    serveAfter='right-grasp-sealed';
  }
  move('right-serve','right','pickup',[serveAfter]);
  release('right-release-cup','right','cup','pickup',['right-serve']);
  move('right-clear-pickup','right','right-ready',['right-release-cup'],'cup');
  return tasks;
}
